import type { Transaction } from "@milkdown/kit/prose/state";
import { ReplaceStep } from "@milkdown/kit/prose/transform";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";

/**
 * The grey suggestion as the plugin holds it (ghost-text-plugin.ts): its
 * text and alternatives, the widget it is drawn with, and what is left of
 * it as the writer types its next characters.
 */

/**
 * The suggestion is rendered via CSS generated content (data-suggestion +
 * ::after) instead of as real text inside the span: WebKit canonicalizes a
 * collapsed caret sitting before a contentEditable=false element that
 * contains text to a visible position AFTER it, painting the caret at the
 * end of the ghost text instead of where the user is actually typing.
 * Generated content offers no caret positions at all, so the caret stays
 * painted at the true insertion point.
 */
export function ghostDecoration(
  doc: ProseNode,
  cursorPos: number,
  suggestion: string | string[],
  index = 0,
  /** A suggestion appearing, rather than the rest of one already on show
   *  (after Ctrl+Right) or its next alternative: only that fades in - a
   *  continuing one stays put, it must not flash. */
  fresh = true,
): Extract<GhostMeta, { type: "set" }> {
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

/** Tagged union (like pending-edit-plugin's PendingMeta) so the "set" arm
 *  carries its payload as required fields - no assertions at the read site. */
export type GhostMeta =
  | {
      type: "set";
      decoration: DecorationSet;
      suggestion: string;
      candidates: string[];
      index: number;
      from: number;
    }
  | { type: "clear" };

export interface GhostState {
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
export const CLEARED: GhostState = {
  decoration: DecorationSet.empty,
  suggestion: null,
  candidates: [],
  index: 0,
  from: 0,
};

/**
 * The suggestion left after an edit that typed exactly its next characters
 * at its spot (" w" of " works" leaves "orks"), or null when the edit was
 * anything else. Alternatives that don't start with the typed text drop
 * out. An IME's preedit never matches (pinyin isn't the Chinese it turns
 * into); its commit can.
 */
export function typedThrough(
  tr: Transaction,
  prev: Pick<GhostState, "suggestion" | "candidates" | "index" | "from">,
): GhostState | null {
  if (!prev.suggestion || tr.steps.length !== 1) return null;
  const step = tr.steps[0];
  if (
    !(step instanceof ReplaceStep) ||
    step.from !== prev.from ||
    step.to !== prev.from
  )
    return null;
  let typed = "";
  let onlyText = true;
  step.slice.content.forEach((node) => {
    if (node.isText) typed += node.text;
    else onlyText = false;
  });
  const to = prev.from + typed.length;
  if (!onlyText || !typed || !tr.selection.empty || tr.selection.from !== to)
    return null;
  const rest = (text: string) =>
    text.startsWith(typed) ? text.slice(typed.length) : "";
  const shown = rest(prev.suggestion);
  if (!shown.trim()) return null;
  const candidates = prev.candidates.map(rest).filter((text) => text.trim());
  const { decoration, suggestion, index, from } = ghostDecoration(
    tr.doc,
    to,
    candidates,
    candidates.indexOf(shown),
    false,
  );
  return { decoration, suggestion, candidates, index, from };
}
