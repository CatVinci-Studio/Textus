import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { zoomButton } from "./diagram-zoom";
import { addBlockFold } from "./fold/block-fold";
import { currentStrings } from "../i18n/current";
import { drawWhileNear } from "./lazy/draw-when-visible";
import { keepReadable } from "./mermaid-blocks";

/**
 * A drawn diagram under its hidden source: the block that folds to a line,
 * the drawing's box (scrolling a wide one) with its zoom button, drawn only
 * near the screen. A click puts the caret back in the source.
 */
export function diagramWidget(
  view: EditorView,
  getPos: () => number | undefined,
  svg: string,
  at: {
    /** What its fold is kept under. */
    fold: string;
  },
): HTMLElement {
  // The block, which folds to a line; the drawing's box inside it
  // scrolls a wide diagram without cutting off the fold's caret.
  const block = document.createElement("div");
  block.className = "mermaid-block";
  const container = document.createElement("div");
  // A fence's box, as in Typora: a theme's rule for code boxes
  // (.md-fences) dresses the drawing alike.
  container.className = "mermaid-preview md-fences";
  block.append(container);
  addBlockFold(block, currentStrings().diagramViewerLabel, at.fold);
  // A drawing is hundreds of elements: kept only within a few
  // screens, its box's size held when let go.
  // The box emptied is the one held: its margins and padding stay.
  drawWhileNear(
    container,
    view.dom,
    () => {
      container.innerHTML = svg;
      keepReadable(container);
      container.append(zoomButton(container));
    },
    () => container.replaceChildren(),
    true,
  );
  container.addEventListener("mousedown", (event) => {
    event.preventDefault();
    // The widget's DOM outlives edits above it, so where its block starts is
    // asked now.
    const end = getPos();
    if (end === undefined) return;
    const block = view.state.doc.resolve(end).nodeBefore;
    if (block?.type.name !== "code_block") return;
    const tr = view.state.tr.setSelection(
      TextSelection.create(view.state.doc, end - block.nodeSize + 1),
    );
    view.dispatch(tr);
    view.focus();
  });
  return block;
}

/** Under a diagram that couldn't be drawn, its source still showing: why,
 *  in the renderer's words (#775). */
export function diagramErrorWidget(why: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "diagram-error";
  box.contentEditable = "false";
  box.setAttribute("role", "note");
  const title = document.createElement("div");
  title.className = "diagram-error-title";
  title.textContent = currentStrings().diagramError;
  const detail = document.createElement("pre");
  detail.className = "diagram-error-detail";
  detail.textContent = why;
  box.append(title);
  if (why) box.append(detail);
  return box;
}
