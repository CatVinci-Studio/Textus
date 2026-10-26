import type { EditorView } from "@milkdown/kit/prose/view";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { isImeKeyEvent } from "../../editor/marks/enclosure";
import { pausesFeatures } from "../../editor/large-doc";
import { createDebouncedTask } from "./debounced-task";
import { hasPendingEdits } from "../revision/pending-edit-plugin";
import { ai, type CompletionHints } from "../../platform/ipc";
import { AiNoticeError } from "../../utils/error-text";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  afterRawHtml,
  completionHints,
  completionContext,
  hasProse,
  isOneLineBlock,
  nextWordChunk,
  splitCandidates,
  stripEcho,
  tidySuggestion,
} from "./ghost-context";
import {
  CLEARED,
  type GhostMeta,
  type GhostState,
  ghostDecoration,
  typedThrough,
} from "./ghost-state";
export { typedThrough } from "./ghost-state";
export {
  tidySuggestion,
  isOneLineBlock,
  stripEcho,
  completionHints,
  proseText,
  hasProse,
  completionContext,
  nextWordChunk,
  splitCandidates,
} from "./ghost-context";

// A pause, not a breath between words: shorter, a request goes out at nearly
// every word, for suggestions typed past before they come.
const DEBOUNCE_MS = 800;
const ghostTextKey = new PluginKey("ghost-text");

/** Whether a reply still belongs where it was asked for: same document and
 *  caret, no IME composition (dispatching would break it), no AI edit shown. */
function stillFits(
  view: EditorView,
  doc: ProseNode,
  cursorPos: number,
): boolean {
  const { selection } = view.state;
  return (
    selection.empty &&
    selection.from === cursorPos &&
    !view.composing &&
    !hasPendingEdits(view.state) &&
    view.state.doc.eq(doc)
  );
}

/** Ends the suggestion as IME input begins, since an IME with its own preedit
 *  window (fcitx5) changes nothing until the commit. Only before composing. */
function dismissForIme(view: EditorView) {
  if (view.composing || !ghostTextKey.getState(view.state)?.suggestion) return;
  view.dispatch(view.state.tr.setMeta(ghostTextKey, { type: "clear" }));
}

/// Asks for a completion at the cursor now, skipping the debounce. Unlike the
/// typing-triggered path, it throws on failure.
export async function triggerGhostTextNow(
  view: EditorView,
  provider: string,
  style: string | null,
  model: string | null,
  project: { docPath: string | null; workspaceRoot: string | null },
  /** The app's language: what to write in when there's no prose to go by. */
  uiLanguage: string | null = null,
): Promise<void> {
  const { selection } = view.state;
  if (!selection.empty) throw new AiNoticeError("completion-needs-caret");

  const $pos = selection.$from;
  if (
    !$pos.parent.isTextblock ||
    $pos.parentOffset !== $pos.parent.content.size ||
    afterRawHtml($pos)
  ) {
    throw new AiNoticeError("completion-needs-paragraph-end");
  }

  const cursorPos = selection.from;
  const doc = view.state.doc;
  const { before, after, prose } = completionContext(doc, cursorPos);
  // An explicit ask gets a few sentences and three alternatives (Alt+[ / ]).
  const hints: CompletionHints = {
    ...completionHints(doc, cursorPos, "long"),
    candidates: 3,
    prose,
    uiLanguage,
  };

  const raw = await ai.complete(
    provider,
    before,
    after,
    style,
    model,
    hints,
    project,
  );
  const candidates = splitCandidates(raw ?? "")
    .map((text) =>
      tidySuggestion(
        before,
        stripEcho(before, text),
        isOneLineBlock(doc, cursorPos),
      ),
    )
    .filter((text, i, all) => text.trim() && all.indexOf(text) === i);
  if (candidates.length === 0) throw new AiNoticeError("completion-empty");
  if (!stillFits(view, doc, cursorPos)) return;

  view.dispatch(
    view.state.tr.setMeta(
      ghostTextKey,
      ghostDecoration(view.state.doc, cursorPos, candidates),
    ),
  );
}

/** Takes back the suggestion on offer, if any - Textus AI was turned off
 *  while it showed. */
export function dismissGhostText(view: EditorView): void {
  if (!ghostTextKey.getState(view.state)?.suggestion) return;
  view.dispatch(
    view.state.tr
      .setMeta(ghostTextKey, { type: "clear" } satisfies GhostMeta)
      .setMeta("addToHistory", false),
  );
}

export function createGhostTextPlugin(options: {
  enabled: () => boolean;
  provider: () => string;
  /** Writing-assistance model; null keeps the provider's low-cost default. */
  model: () => string | null;
  /** User style directive for the completion prompt, null when unset. */
  style: () => string | null;
  /** The project folder the completion takes its style profile and
   *  library from. */
  project: () => { docPath: string | null; workspaceRoot: string | null };
  /** The app's language: what a completion is written in when the text
   *  around the caret has too little prose to tell. */
  uiLanguage: () => string;
  /** A suggestion was taken (Tab, a tap) - the tour's completion lesson. */
  onAccept?: () => void;
}) {
  const debounced = createDebouncedTask(DEBOUNCE_MS);
  // Set by an accept: inserting the suggestion isn't typing, and shouldn't
  // ask again at once. The next keystroke asks as usual.
  let accepted = false;

  return $prose(
    () =>
      new Plugin<GhostState>({
        key: ghostTextKey,
        state: {
          init: (): GhostState => CLEARED,
          apply(tr, prev, _old, state): GhostState {
            const meta = tr.getMeta(ghostTextKey) as GhostMeta | undefined;
            if (meta?.type === "set") {
              const { decoration, suggestion, candidates, index, from } = meta;
              return { decoration, suggestion, candidates, index, from };
            }
            if (meta?.type === "clear") return CLEARED;
            // Typing the suggestion's own next letters keeps the rest on
            // offer; any other edit ends it.
            if (tr.docChanged) return typedThrough(tr, prev) ?? CLEARED;
            // The caret moved off: kept, a later Tab elsewhere would insert
            // it at the old spot.
            if (
              prev.suggestion &&
              tr.selectionSet &&
              (!state.selection.empty || state.selection.from !== prev.from)
            )
              return CLEARED;
            return prev;
          },
        },
        props: {
          decorations(state) {
            return ghostTextKey.getState(state)?.decoration;
          },
          // On a phone a tap accepts it, caught at touchend before WebKit
          // moves the caret, which would clear the suggestion first.
          handleDOMEvents: {
            touchend(view, event) {
              const state = ghostTextKey.getState(view.state);
              const target = event.target as HTMLElement | null;
              if (!state?.suggestion || !target?.closest?.(".ghost-text"))
                return false;
              event.preventDefault();
              const tr = view.state.tr.insertText(state.suggestion, state.from);
              tr.setMeta(ghostTextKey, { type: "clear" });
              accepted = true;
              view.dispatch(tr);
              options.onAccept?.();
              return true;
            },
            compositionstart(view) {
              dismissForIme(view);
              return false;
            },
          },
          handleKeyDown(view, event) {
            if (isImeKeyEvent(view, event)) {
              dismissForIme(view);
              return false;
            }
            const state = ghostTextKey.getState(view.state);
            if (!state?.suggestion) return false;
            if (event.key === "Escape") {
              event.preventDefault();
              view.dispatch(
                view.state.tr.setMeta(ghostTextKey, { type: "clear" }),
              );
              return true;
            }
            const { selection } = view.state;
            if (!selection.empty || selection.from !== state.from) return false;
            // Alt+] / Alt+[ cycle the alternatives (by key code: on macOS
            // Option+] types a quote character into event.key).
            if (
              event.altKey &&
              (event.code === "BracketRight" || event.code === "BracketLeft") &&
              state.candidates.length > 1
            ) {
              event.preventDefault();
              const step = event.code === "BracketRight" ? 1 : -1;
              const n = state.candidates.length;
              view.dispatch(
                view.state.tr.setMeta(
                  ghostTextKey,
                  ghostDecoration(
                    view.state.doc,
                    state.from,
                    state.candidates,
                    (state.index + step + n) % n,
                    false,
                  ),
                ),
              );
              return true;
            }
            // Ctrl/Cmd+Right takes one word and keeps the rest on offer.
            if (
              (event.ctrlKey || event.metaKey) &&
              !event.shiftKey &&
              event.key === "ArrowRight"
            ) {
              event.preventDefault();
              const chunk = nextWordChunk(state.suggestion);
              const rest = state.suggestion.slice(chunk.length);
              const tr = view.state.tr.insertText(chunk, state.from);
              // Built against the document after the insertion.
              tr.setMeta(
                ghostTextKey,
                rest.trim()
                  ? ghostDecoration(
                      tr.doc,
                      state.from + chunk.length,
                      rest,
                      0,
                      false,
                    )
                  : { type: "clear" },
              );
              view.dispatch(tr);
              return true;
            }
            if (event.key !== "Tab") return false;
            event.preventDefault();
            const tr = view.state.tr.insertText(state.suggestion, state.from);
            tr.setMeta(ghostTextKey, { type: "clear" });
            accepted = true;
            view.dispatch(tr);
            options.onAccept?.();
            return true;
          },
        },
        view() {
          return {
            update(view, prevState) {
              // A CSS-drawn caret stands in at a suggestion, as WebKit paints
              // the native one after it. Before every early return below, as
              // a manual suggestion can come while triggering is off.
              const ghost = ghostTextKey.getState(view.state);
              const pinned =
                !!ghost?.suggestion &&
                view.state.selection.empty &&
                view.state.selection.from === ghost.from;
              view.dom.classList.toggle("ghost-text-caret", pinned);

              // Any edit or caret move makes a debounced request stale,
              // even where the checks below return early.
              if (
                view.state.doc !== prevState.doc ||
                !view.state.selection.eq(prevState.selection)
              )
                debounced.cancel();

              if (accepted) {
                accepted = false;
                return;
              }
              if (!options.enabled()) return;
              if (view.composing) return;
              // A suggestion is still on offer right here (say, the rest
              // after accepting one word): asking again would replace it.
              if (pinned) return;
              if (pausesFeatures(view.state.doc)) return;
              if (
                view.state.doc.eq(prevState.doc) &&
                view.state.selection.eq(prevState.selection)
              ) {
                return;
              }
              // Ghost text over a pending AI edit would be unreadable, and
              // Tab could land inside it.
              if (hasPendingEdits(view.state)) return;

              const { selection, doc } = view.state;
              if (!selection.empty) return;

              const $pos = selection.$from;
              const atBlockEnd =
                $pos.parent.isTextblock &&
                $pos.parentOffset === $pos.parent.content.size &&
                !afterRawHtml($pos);
              if (!atBlockEnd) return;

              const cursorPos = selection.from;
              const { before, after, prose } = completionContext(
                doc,
                cursorPos,
              );
              // An empty paragraph's subject is the writer's alone; "Continue
              // writing" still asks.
              if ($pos.parent.content.size === 0) return;
              // After punctuation the next words are the writer's choice and
              // suggestions rarely help; only a pause after a word asks.
              if (
                !$pos.parent.type.spec.code &&
                !/[\p{L}\p{N}]\s?$/u.test(before)
              )
                return;
              // No minimum length, so a fresh document's first sentence asks
              // too; only an empty before-text has nothing to continue.
              if (!before.trim()) return;
              // Outside code, a before-text of only code has no prose to
              // continue either.
              if (!$pos.parent.type.spec.code && !hasProse(prose)) return;

              debounced.schedule(async (isCurrent) => {
                // Turned off while the request waited out the debounce.
                if (!options.enabled()) return;
                let suggestion: string;
                try {
                  suggestion = await ai.complete(
                    options.provider(),
                    before,
                    after,
                    options.style(),
                    options.model(),
                    {
                      ...completionHints(doc, cursorPos, "short"),
                      prose,
                      uiLanguage: options.uiLanguage(),
                    },
                    options.project(),
                  );
                } catch (err) {
                  // Quiet in the UI while typing, but logged.
                  console.error("[ghost-text] completion request failed:", err);
                  return;
                }
                if (!isCurrent()) return; // superseded by a newer trigger
                if (!options.enabled()) return;
                suggestion = tidySuggestion(
                  before,
                  stripEcho(before, suggestion),
                  isOneLineBlock(doc, cursorPos),
                );
                if (!suggestion?.trim()) return;
                if (!view.hasFocus() || !stillFits(view, doc, cursorPos))
                  return;

                view.dispatch(
                  view.state.tr.setMeta(
                    ghostTextKey,
                    ghostDecoration(view.state.doc, cursorPos, suggestion),
                  ),
                );
              });
            },
            destroy() {
              debounced.cancel();
            },
          };
        },
      }),
  );
}
