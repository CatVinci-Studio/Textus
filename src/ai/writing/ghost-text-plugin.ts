import type { EditorView } from "@milkdown/kit/prose/view";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { isImeKeyEvent } from "../../editor/marks/enclosure";
import { isLargeDoc } from "../../editor/large-doc";
import { createDebouncedTask } from "./debounced-task";
import { hasPendingEdits } from "../revision/pending-edit-plugin";
import { ai, type CompletionHints } from "../../platform/ipc";
import { AiNoticeError } from "../../utils/error-text";
import { cjkChunk, isCjk, isCjkLetter } from "../../utils/cjk";
import { headingTrail } from "../doc-markdown";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";

const DEBOUNCE_MS = 450;
const MAX_CONTEXT_CHARS = 2000;
// Look-ahead after the cursor: enough for the model to splice into what
// follows when completing mid-document, small enough not to dominate the
// prompt.
const MAX_AFTER_CONTEXT_CHARS = 500;

const ghostTextKey = new PluginKey("ghost-text");

/**
 * Models often start a continuation with a space out of English habit; after
 * CJK text (or CJK punctuation) that space is wrong - CJK doesn't separate
 * with spaces - so it's stripped. Latin before-text keeps the suggestion
 * verbatim: a leading space there is usually a correct word boundary.
 */
export function tidySuggestion(
  before: string,
  suggestion: string,
  oneLine = false,
): string {
  const text = isCjk(before.slice(-1))
    ? suggestion.replace(/^[ \t]+/, "")
    : suggestion;
  // A table cell or a heading holds one line: a line break taken into one
  // split the table row (or the heading) when the file was saved.
  return oneLine ? text.replace(/[ \t]*\n+[ \t]*/g, " ").trimEnd() : text;
}

/** Whether the caret's block is one line in Markdown (a table cell, a
 *  heading), where a suggestion can't carry a line break. */
export function isOneLineBlock(doc: ProseNode, pos: number): boolean {
  const $pos = doc.resolve(pos);
  if ($pos.parent.type.name === "heading") return true;
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.spec.tableRole?.endsWith("cell")) return true;
  }
  return false;
}

/**
 * Models sometimes open the continuation by repeating the end of the
 * before-text ("...the results show" -> "the results show that ..."),
 * which Tab would then insert twice. A repeat of at least a few words is
 * cut; a short overlap is left alone, since "the " ending one sentence and
 * starting the next is ordinary prose.
 */
export function stripEcho(before: string, suggestion: string): string {
  const max = Math.min(before.length, suggestion.length, 200);
  for (let k = max; k >= 6; k--) {
    if (before.endsWith(suggestion.slice(0, k))) return suggestion.slice(k);
  }
  return suggestion;
}

const BLOCK_NAMES: Record<string, string> = {
  heading: "heading",
  list_item: "list item",
  blockquote: "blockquote",
  table_cell: "table cell",
  table_header: "table cell",
  // Without it a code block went out as a "paragraph" and the model had to
  // guess it was continuing code (the live eval scored the hinted case
  // higher - docs/design/ai-eval.md).
  code_block: "code block",
};

/**
 * What the 2000 characters around the cursor can't say on their own: what
 * the document is (its first heading), which section is being written (the
 * heading path down to the cursor), and what kind of block the cursor is in
 * - without which a completion inside a list item or a heading came back as
 * a full prose sentence. Walks top-level blocks only, and runs once per
 * request (inside the debounce), not per keystroke.
 */
export function completionHints(
  doc: ProseNode,
  cursorPos: number,
  length: CompletionHints["length"],
): CompletionHints {
  const { title, path } = headingTrail(doc, cursorPos);

  const $pos = doc.resolve(cursorPos);
  let block = "paragraph";
  for (let depth = $pos.depth; depth > 0; depth--) {
    const name = BLOCK_NAMES[$pos.node(depth).type.name];
    if (name) {
      block = name;
      break;
    }
  }
  // The heading being typed in isn't a section *around* the cursor yet.
  const section = block === "heading" ? [] : path.slice(-4).map((h) => h.text);
  return { title, section, block, length };
}

function completionContext(
  view: EditorView,
  cursorPos: number,
): { before: string; after: string } {
  // Scanned over a bounded window around the cursor, not the whole document:
  // this runs on every keystroke at a block end, BEFORE the debounce. A
  // character occupies at least one position, so a 4x-margin position window
  // always covers the characters actually kept below (block boundaries eat
  // positions without emitting characters - hence the margin, not 1x).
  const { doc } = view.state;
  const before = doc.textBetween(
    Math.max(0, cursorPos - 4 * MAX_CONTEXT_CHARS),
    cursorPos,
    "\n\n",
  );
  const after = doc.textBetween(
    cursorPos,
    Math.min(doc.content.size, cursorPos + 4 * MAX_AFTER_CONTEXT_CHARS),
    "\n\n",
  );
  return {
    before: before.slice(Math.max(0, before.length - MAX_CONTEXT_CHARS)),
    after: after.slice(0, MAX_AFTER_CONTEXT_CHARS),
  };
}

/**
 * The suggestion is rendered via CSS generated content (data-suggestion +
 * ::after) instead of as real text inside the span: WebKit canonicalizes a
 * collapsed caret sitting before a contentEditable=false element that
 * contains text to a visible position AFTER it, painting the caret at the
 * end of the ghost text instead of where the user is actually typing.
 * Generated content offers no caret positions at all, so the caret stays
 * painted at the true insertion point.
 */
function ghostDecoration(
  doc: ProseNode,
  cursorPos: number,
  suggestion: string | string[],
  index = 0,
  /** A suggestion appearing, rather than the rest of one already on show
   *  (after Ctrl+Right) or its next alternative: only that fades in - a
   *  continuing one stays put, it must not flash. */
  fresh = true,
): GhostMeta {
  const candidates = Array.isArray(suggestion) ? suggestion : [suggestion];
  const shown = candidates[index] ?? "";
  const decorations = [
    Decoration.widget(
      cursorPos,
      () => {
        const span = document.createElement("span");
        span.className = fresh ? "ghost-text ghost-text-enter" : "ghost-text";
        span.setAttribute("data-suggestion", shown);
        span.contentEditable = "false";
        return span;
      },
      {
        side: 1,
        ignoreSelection: true,
        key: `ghost-${index}-${fresh ? "new" : "kept"}-${shown}`,
      },
    ),
  ];
  // With alternatives, a quiet "2/3 · Alt+]" after the text says there are
  // more and how to reach them.
  if (candidates.length > 1) {
    decorations.push(
      Decoration.widget(
        cursorPos,
        () => {
          const badge = document.createElement("span");
          badge.className = "ghost-text-count";
          badge.setAttribute(
            "data-count",
            `${index + 1}/${candidates.length} · Alt+]`,
          );
          badge.contentEditable = "false";
          return badge;
        },
        { side: 2, ignoreSelection: true, key: `ghost-count-${index}` },
      ),
    );
  }
  return {
    type: "set",
    decoration: DecorationSet.create(doc, decorations),
    suggestion: shown,
    candidates,
    index,
    from: cursorPos,
  };
}

/**
 * The next piece of a suggestion that Ctrl/Cmd+Right accepts on its own:
 * leading space plus one word - or, for CJK text, which has no spaces to
 * find words by, up to two characters (and any punctuation right after).
 */
export function nextWordChunk(text: string): string {
  const lead = /^\s*/.exec(text)?.[0] ?? "";
  const rest = text.slice(lead.length);
  if (!rest) return text;
  if (isCjkLetter(rest[0])) return lead + (cjkChunk(rest) ?? rest[0]);
  const m = /^\S+/.exec(rest);
  return lead + (m ? m[0] : rest);
}

/** The alternatives in a multi-candidate response (CANDIDATE_SEPARATOR in
 *  src-tauri ai/client.rs); a single continuation comes back as one. Only
 *  whole lines after the separator go with it: a candidate's leading space
 *  is the join the backend made onto the before-text ("quickly" + " grew").
 *  The separator is cut wherever it sits - at the very start (the first
 *  alternative was dropped) or on a candidate's own line, which a model
 *  sometimes writes - rather than only on a line of its own; left in, Tab
 *  inserted "<<<>>>" into the document. */
export function splitCandidates(raw: string): string[] {
  return raw.split(/\s*<<<>>>(?:[ \t]*\n)*/).filter((part) => part.trim());
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
): Promise<void> {
  const { selection } = view.state;
  if (!selection.empty) throw new AiNoticeError("completion-needs-caret");

  const $pos = selection.$from;
  if (
    !$pos.parent.isTextblock ||
    $pos.parentOffset !== $pos.parent.content.size
  ) {
    throw new AiNoticeError("completion-needs-paragraph-end");
  }

  const cursorPos = selection.from;
  const { before, after } = completionContext(view, cursorPos);
  // An explicit request earns more than the as-you-type nudge: a few
  // sentences carrying the paragraph on, which is what "continue writing"
  // means when someone asks for it.
  // Three alternatives on an explicit ask, cycled with Alt+[ / Alt+].
  const hints = {
    ...completionHints(view.state.doc, cursorPos, "long"),
    candidates: 3,
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
        isOneLineBlock(view.state.doc, cursorPos),
      ),
    )
    .filter((text, i, all) => text.trim() && all.indexOf(text) === i);
  if (candidates.length === 0) throw new AiNoticeError("completion-empty");
  if (view.state.selection.from !== cursorPos) return; // cursor moved while we were waiting
  if (view.composing) return; // mid-IME - dispatching now would break the composition

  view.dispatch(
    view.state.tr.setMeta(
      ghostTextKey,
      ghostDecoration(view.state.doc, cursorPos, candidates),
    ),
  );
}

/// Shows a caller-supplied suggestion as ghost text at the caret, no backend
/// involved - the onboarding tutorial's completion step uses this with a
/// pre-written continuation so first-run users see the feature without an
/// AI account. Tab-accept and clear-on-edit behave exactly like the real
/// thing (same plugin state).
export function showGhostSuggestion(
  view: EditorView,
  suggestion: string,
): void {
  const { selection } = view.state;
  if (!selection.empty || view.composing || !suggestion) return;
  view.dispatch(
    view.state.tr.setMeta(
      ghostTextKey,
      ghostDecoration(view.state.doc, selection.from, suggestion),
    ),
  );
}

/** Tagged union (like pending-edit-plugin's PendingMeta) so the "set" arm
 *  carries its payload as required fields - no assertions at the read site. */
type GhostMeta =
  | {
      type: "set";
      decoration: DecorationSet;
      suggestion: string;
      candidates: string[];
      index: number;
      from: number;
    }
  | { type: "clear" };

interface GhostState {
  decoration: DecorationSet;
  suggestion: string | null;
  /** All alternatives (manual trigger asks for several); `suggestion` is
   *  candidates[index]. */
  candidates: string[];
  index: number;
  from: number;
}

/** The no-suggestion state - shared by init, clear, and the edit-invalidated
 *  branch. Immutable by convention (never mutated, only replaced). */
const CLEARED: GhostState = {
  decoration: DecorationSet.empty,
  suggestion: null,
  candidates: [],
  index: 0,
  from: 0,
};

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
            if (meta?.type === "clear" || tr.docChanged) return CLEARED;
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
              return true;
            },
          },
          handleKeyDown(view, event) {
            if (isImeKeyEvent(view, event)) return false;
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
              // suggestion. Runs before every early return below - mock
              // suggestions (showGhostSuggestion) arrive while the plugin's
              // own triggering is disabled, and the swap must still track
              // the caret leaving/returning.
              const ghost = ghostTextKey.getState(view.state);
              const pinned =
                !!ghost?.suggestion &&
                view.state.selection.empty &&
                view.state.selection.from === ghost.from;
              view.dom.classList.toggle("ghost-text-caret", pinned);

              if (accepted) {
                accepted = false;
                debounced.cancel();
                return;
              }
              if (!options.enabled()) return;
              if (view.composing) return;
              // A suggestion is still on offer right here (say, the rest
              // after accepting one word): asking again would replace it.
              if (pinned) return;
              if (isLargeDoc(view.state.doc)) return;
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

              debounced.cancel();

              const { selection } = view.state;
              if (!selection.empty) return;

              const $pos = selection.$from;
              const atBlockEnd =
                $pos.parent.isTextblock &&
                $pos.parentOffset === $pos.parent.content.size;
              if (!atBlockEnd) return;

              const cursorPos = selection.from;
              const { before, after } = completionContext(view, cursorPos);
              // The cursor is at the end of its own paragraph, but the
              // document keeps going right after it (e.g. editing mid-
              // document) - a suggestion here would be inserted ahead of
              // content that already continues the thought, so auto-trigger
              // stays quiet. Manual trigger (triggerGhostTextNow) still
              // works - that's an explicit ask, not a typing side-effect.
              if (after.trim()) return;
              // No minimum context length: completion is opt-in via the
              // Settings toggle already, and gating on word count made the
              // very first sentence of a fresh document (and the onboarding
              // tutorial, which demonstrates completion in its first
              // paragraph) unable to trigger it at all. An empty before-text
              // is the only real no-op case - "continue from the exact end
              // of the before-text" is meaningless with no before-text.
              if (!before.trim()) return;

              debounced.schedule(async (isCurrent) => {
                let suggestion: string;
                try {
                  suggestion = await ai.complete(
                    options.provider(),
                    before,
                    after,
                    options.style(),
                    options.model(),
                    completionHints(view.state.doc, cursorPos, "short"),
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
                suggestion = tidySuggestion(
                  before,
                  stripEcho(before, suggestion),
                  isOneLineBlock(view.state.doc, cursorPos),
                );
                if (!suggestion?.trim()) return;
                if (!view.hasFocus() || view.state.selection.from !== cursorPos)
                  return;
                if (view.composing) return; // mid-IME - dispatching now would break the composition

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
