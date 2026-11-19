import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { boxIn, handlePlace } from "../blocks/block-handle-place";
import { foldCaret, labelFoldCaret } from "./block-fold";

/**
 * A folded heading's caret, standing in the margin while it is folded, where
 * ⋮⋮'s fold button stands on hover (block-handles-plugin.ts): laid out as
 * that handle is, the grip's room kept empty, so the two meet. Outside the
 * text: nothing of it is in the heading.
 */
export class HeadingFoldMarks {
  private readonly root: HTMLElement;
  private marks: HTMLElement[] = [];
  /** Widgets a folded-away block draws after itself, hidden with it. */
  private away: HTMLElement[] = [];
  private frame = 0;
  private readonly resized = new ResizeObserver(() => this.place());

  constructor(
    private readonly view: EditorView,
    private readonly foldedAt: (state: EditorState) => readonly number[],
    private readonly toggle: (view: EditorView, heading: number) => void,
  ) {
    this.root = view.dom.parentElement as HTMLElement;
    this.resized.observe(view.dom);
    this.hideWidgets();
    this.place();
  }

  update(view: EditorView, before: EditorState) {
    const at = this.foldedAt(view.state);
    if (at.length === 0 && this.marks.length === 0 && !this.away.length) return;
    // Also when only decorations changed: a view drawn again is a new
    // widget to mark.
    this.hideWidgets();
    if (view.state.doc === before.doc && at === this.foldedAt(before)) return;
    this.place();
  }

  /** Marked at once, as the change is drawn: a sibling rule in CSS would
   *  restyle every block on each one added. */
  private hideWidgets() {
    for (const widget of this.away) delete widget.dataset.foldedAway;
    this.away = [];
    if (this.foldedAt(this.view.state).length === 0) return;
    for (const block of this.view.dom.querySelectorAll(
      ":scope > .heading-folded-away",
    )) {
      let next = block.nextElementSibling;
      while (
        next instanceof HTMLElement &&
        next.classList.contains("ProseMirror-widget")
      ) {
        next.dataset.foldedAway = "";
        this.away.push(next);
        next = next.nextElementSibling;
      }
    }
  }

  /** Laid out once the change is drawn. */
  private place() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  private draw() {
    const { view } = this;
    const at = this.foldedAt(view.state);
    while (this.marks.length > at.length) this.marks.pop()!.remove();
    while (this.marks.length < at.length) this.marks.push(this.mark());
    at.forEach((pos, i) => {
      const mark = this.marks[i]!;
      const heading = view.nodeDOM(pos);
      if (!(heading instanceof HTMLElement) || !heading.isConnected) {
        mark.hidden = true;
        return;
      }
      mark.hidden = false;
      mark.dataset.pos = String(pos);
      labelFoldCaret(
        mark.firstElementChild as HTMLElement,
        true,
        heading.textContent ?? "",
      );
      const line =
        parseFloat(getComputedStyle(heading).lineHeight) ||
        heading.offsetHeight;
      const { x, y } = handlePlace(boxIn(this.root, heading), line, {
        w: mark.offsetWidth,
        h: mark.offsetHeight,
      });
      mark.style.translate = `${x}px ${y}px`;
    });
  }

  /** A mark: the caret, and the grip's room beside it. */
  private mark(): HTMLElement {
    const mark = document.createElement("div");
    mark.className = "heading-fold-mark";
    const caret = foldCaret();
    caret.classList.replace("block-fold", "block-handle-button");
    caret.classList.add("block-handle-fold");
    caret.tabIndex = -1;
    caret.addEventListener("mousedown", (e) => e.preventDefault());
    caret.addEventListener("click", (e) => {
      e.preventDefault();
      const pos = Number(mark.dataset.pos);
      if (Number.isFinite(pos)) this.toggle(this.view, pos);
    });
    const room = document.createElement("span");
    room.className = "block-handle-button heading-fold-room";
    room.setAttribute("aria-hidden", "true");
    mark.append(caret, room);
    this.root.append(mark);
    return mark;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.resized.disconnect();
    for (const mark of this.marks) mark.remove();
    for (const widget of this.away) delete widget.dataset.foldedAway;
  }
}
