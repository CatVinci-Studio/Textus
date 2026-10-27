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

// A pause, not a breath between words: at 450 ms a request went out at
// nearly every word, most of them for suggestions the writer had typed
// past before they came (1.2.0-rc.6).
const DEBOUNCE_MS = 800;
const ghostTextKey = new PluginKey("ghost-text");

/** Whether a reply asked for at `cursorPos` in `doc` still belongs there
 *  when it arrives: the document as it was (nothing typed, pasted, undone
 *  or written in by Textus AI since), the caret where it was, no IME
 *  composition under way (dispatching would break it) and no AI edit on
 *  show. The caret alone said too little after an edit that asks for no
 *  new request of its own (one mid-composition, or with an AI edit on
 *  show): the reply then continued text that was no longer there. */
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

/** Ends the suggestion as IME input begins - its first key (keyCode 229)
 *  or compositionstart - rather than when the committed text reaches the
 *  document: an IME that keeps its preedit in its own window (fcitx5 can)
 *  changes nothing in the document until the commit, and the suggestion
 *  stayed on show the whole time. Done only while no composition is under
 *  way yet; a transaction mid-composition would break it. */
function dismissForIme(view: EditorView) {
  if (view.composing || !ghostTextKey.getState(view.state)?.suggestion) return;
  view.dispatch(view.state.tr.setMeta(ghostTextKey, { type: "clear" }));
}

/// Runs a completion request right now at the cursor and shows it as ghost
/// text, bypassing the debounce/word-count gating the typing-triggered path
/// uses - for manual "trigger completion" entry points (e.g. a context menu
/// item). Unlike the silent auto-trigger path, this throws on failure so the
/// caller can surface the error to the user.
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
  // An explicit request earns more than the as-you-type nudge: a few
  // sentences carrying the paragraph on, which is what "continue writing"
  // means when someone asks for it.
  // Three alternatives on an explicit ask, cycled with Alt+[ / Alt+].
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
  // Set by an accept (Tab, a tap): the edit that inserts the suggestion
  // isn't typing, and asking again at once spent a request on a second
  // suggestion nobody waited for - one that often opened mid-thought
  // ("and ..." after a full stop). The next keystroke asks as usual.
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
            // offer; any other edit ends it - text that differs, a paste,
            // an undo, an IME's preedit, a Textus AI edit going in.
            if (tr.docChanged) return typedThrough(tr, prev) ?? CLEARED;
            // The caret moved off the suggestion: it no longer belongs where
            // the user is. Kept alive, a later Tab (say, indenting a list
            // item elsewhere) inserted it back at the old spot.
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
          // A phone has no Tab key: there the suggestion takes touches
          // (mobile/styles) and a tap on it accepts it. Caught at touchend,
          // before WebKit moves the caret to the tap - which would clear
          // the suggestion first.
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
              // The native caret is swapped for a CSS-drawn one (the ghost
              // span's ::before, see milkdown-theme.css) while the caret
              // sits exactly where a suggestion is showing: WebKit's caret
              // canonicalization otherwise paints the caret AFTER the
              // suggestion. Runs before every early return below - a
              // suggestion asked for by hand (triggerGhostTextNow) can
              // arrive while the plugin's own triggering is off, and the
              // swap must still track the caret leaving/returning.
              const ghost = ghostTextKey.getState(view.state);
              const pinned =
                !!ghost?.suggestion &&
                view.state.selection.empty &&
                view.state.selection.from === ghost.from;
              view.dom.classList.toggle("ghost-text-caret", pinned);

              // Any edit or caret move makes a request still waiting out
              // the debounce stale, whether or not a new one is asked for
              // below - during an IME composition or an AI edit too, which
              // return early: the old request used to go out regardless.
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
              // A pending agent edit already occupies this spot with its own
              // ghost-style insert widget (pending-edit-plugin.ts) - stacking
              // completion ghost text on top of it would be unreadable, and
              // accepting one via Tab could land inside the other.
              if (hasPendingEdits(view.state)) return;

              const { selection, doc } = view.state;
              if (!selection.empty) return;

              const $pos = selection.$from;
              // In code a suggestion ran many lines over what was typed.
              if ($pos.parent.type.spec.code) return;
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
              // An empty new paragraph: what it will be about is the
              // writer's alone - the typing replay found suggestions there
              // the least useful of all (completion_replay). "Continue
              // writing" (triggerGhostTextNow) still asks.
              if ($pos.parent.content.size === 0) return;
              // Right after punctuation - a full stop, a comma - the next
              // words are the writer's own choice: suggestions there were
              // useful three times in ten, mid-clause seven
              // (completion_replay). Only a pause after a word asks.
              if (!/[\p{L}\p{N}]\s?$/u.test(before)) return;
              // Mid-document, at the end of a paragraph with more after it,
              // the suggestion leads into what follows (the after-text goes
              // along); it used to stay quiet there.
              // No minimum context length: completion is opt-in via the
              // Settings toggle already, and gating on word count made the
              // very first sentence of a fresh document (and the onboarding
              // tutorial, which demonstrates completion in its first
              // paragraph) unable to trigger it at all. An empty before-text
              // is the only real no-op case - "continue from the exact end
              // of the before-text" is meaningless with no before-text.
              if (!before.trim()) return;
              // Only code before (a diagram's source): no prose to continue.
              if (!hasProse(prose)) return;

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
                  // Not logged in, offline, or request failed - stays quiet in the
                  // UI (no error popup while you're just typing), but still
                  // logged so it's diagnosable instead of vanishing entirely.
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
