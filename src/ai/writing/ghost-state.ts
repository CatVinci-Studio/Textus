import type { Transaction } from "@milkdown/kit/prose/state";
import { ReplaceStep } from "@milkdown/kit/prose/transform";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";

/** The grey inline suggestion's state and widget. */

/** Drawn as CSS generated content, not text: WebKit paints a caret before a
 *  non-editable span with text after that text instead of where it is. */
export function ghostDecoration(
  doc: ProseNode,
  cursorPos: number,
  suggestion: string | string[],
  index = 0,
  /** A new suggestion, which fades in; a continuing one must not flash. */
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

/** The no-suggestion state. Never mutated, only replaced. */
export const CLEARED: GhostState = {
  decoration: DecorationSet.empty,
  suggestion: null,
  candidates: [],
  index: 0,
  from: 0,
};

/** The suggestion left after an edit that typed exactly its next characters
 *  (" w" of " works" leaves "orks"), else null. An IME's preedit never matches. */
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
