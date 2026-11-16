import type { ResolvedPos, Node as ProseNode } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { stateWithLiveSelection } from "../live-selection";

const isHtml = (node: ProseNode | null | undefined) =>
  node?.type.name === "html";

/**
 * Left and Right across inline HTML, one character a press. A hidden tag
 * has no caret position at its edge for the browser to stop on, and a shown
 * one has two drawn as one spot, so each step is taken here.
 */
export function arrowOntoHtml(view: EditorView, event: KeyboardEvent): boolean {
  const step =
    event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
  if (!step || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey)
    return false;
  const state = stateWithLiveSelection(view);
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const target = htmlStep(state.doc.resolve($from.pos), step);
  if (target === null) return false;
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)));
  return true;
}

/** Where one character's step from `$pos` lands when HTML is in the way;
 *  null to leave it to the browser. */
function htmlStep($pos: ResolvedPos, step: 1 | -1): number | null {
  const pos = $pos.pos;
  const ahead = step === 1 ? $pos.nodeAfter : $pos.nodeBefore;
  if (isHtml($pos.parent)) {
    // At the tag's inside edge: out, and one character on.
    const atEdge =
      step === 1
        ? $pos.parentOffset === $pos.parent.content.size
        : $pos.parentOffset === 0;
    if (!atEdge) return null;
    const $out = $pos.doc.resolve(step === 1 ? $pos.after() : $pos.before());
    const next = step === 1 ? $out.nodeAfter : $out.nodeBefore;
    return next?.isText ? $out.pos + step : $out.pos;
  }
  if (!$pos.parent.inlineContent) return null;
  // Right against a tag (its source showing): into it, one character on.
  if (isHtml(ahead)) return ahead!.content.size ? pos + 2 * step : null;
  // A character away from a tag: onto its edge.
  const behind = step === 1 ? $pos.nodeBefore : $pos.nodeAfter;
  if (isHtml(behind) || !ahead?.isText) return null;
  const $target = $pos.doc.resolve(pos + step);
  const beyond = step === 1 ? $target.nodeAfter : $target.nodeBefore;
  return isHtml(beyond) ? pos + step : null;
}
