import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { watchContentZoom } from "../engine/zoom/tab-zoom";
import { caretBox } from "./drawn-caret-box";
import "./drawn-caret.css";

/**
 * The caret drawn in place of the system's, so it is one height through a
 * line and can glide (Smooth caret): for a caret with nothing selected in
 * a focused editor, an input method's composing included. It stands where
 * the browser's own caret is - the one the input method follows - and
 * only where the browser gives no place (beside a picture, a formula, a
 * hidden mark), where the editor computes it. Beside a picture it is as
 * tall as the picture. Placed once a frame at most.
 */
/** Events after which the caret may stand elsewhere. */
const MOVES = [
  "focus",
  "blur",
  "compositionstart",
  "compositionupdate",
  "compositionend",
  "input",
];

class DrawnCaret {
  private readonly root: HTMLElement;
  private readonly caret = document.createElement("div");
  private frame = 0;
  private blink = false;

  constructor(
    private readonly view: EditorView,
    private readonly enabled: () => boolean,
    private readonly glide: () => boolean,
  ) {
    this.root = view.dom.parentElement as HTMLElement;
    this.caret.className = "drawn-caret";
    this.caret.setAttribute("aria-hidden", "true");
    // The editor's alone: an export or a print leaves it out.
    this.caret.dataset.editorChrome = "";
    this.caret.hidden = true;
    this.root.append(this.caret);
    for (const name of MOVES) view.dom.addEventListener(name, this.schedule);
    document.addEventListener("selectionchange", this.schedule);
    // The lines move under it when the document zooms or the page
    // narrows: placed again then, at the new size.
    this.stopZoom = watchContentZoom(this.schedule, this.root);
    this.resized.observe(this.root);
  }

  private readonly stopZoom: () => void;
  private readonly resized = new ResizeObserver(() => this.schedule());

  private readonly schedule = () => {
    if (!this.frame) this.frame = requestAnimationFrame(this.place);
  };

  /** The browser's caret in this editor, on screen; null where there is
   *  none, a selection, or no box for it. */
  private browserCaret(): DOMRect | null {
    const selection = this.view.dom.ownerDocument.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return null;
    if (!this.view.dom.contains(selection.focusNode)) return null;
    const range = selection.getRangeAt(0);
    const rects = range.getClientRects();
    const box = rects.length ? rects[rects.length - 1] : null;
    return box && box.height > 0 ? box : null;
  }

  /** The box of the picture right before or after the caret, if any. */
  private pictureBeside(): DOMRect | null {
    const { $head } = this.view.state.selection;
    const before = $head.nodeBefore?.type.name === "image";
    const after = $head.nodeAfter?.type.name === "image";
    if (!before && !after) return null;
    const pos = before ? $head.pos - $head.nodeBefore!.nodeSize : $head.pos;
    const dom = this.view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return null;
    const img =
      dom instanceof HTMLImageElement ? dom : dom.querySelector("img");
    const box = (img ?? dom).getBoundingClientRect();
    return box.height > 0 ? box : null;
  }

  private readonly place = () => {
    this.frame = 0;
    const { view } = this;
    const live = view.hasFocus() ? this.browserCaret() : null;
    // While an input method composes, the browser's selection is the
    // caret; the editor's catches up when it is done.
    const empty = view.composing ? !!live : view.state.selection.empty;
    const on = this.enabled() && view.editable && view.hasFocus() && empty;
    this.root.classList.toggle("drawn-caret-on", on);
    const wasHidden = this.caret.hidden;
    this.caret.hidden = !on;
    if (!on) return;
    const { $head } = view.state.selection;
    // At a line's end after a formula or a picture, the editor keeps a
    // break; the browser's caret may stand after it, on the line below,
    // and the editor's own place too: the side before it. Outside a
    // composition, the line is the editor's to say. After a code block's
    // last newline, the side before is still the line above.
    const atEnd =
      $head.parentOffset === $head.parent.content.size &&
      !$head.nodeBefore?.text?.endsWith("\n");
    const own = view.coordsAtPos($head.pos, atEnd ? -1 : 1);
    const offLine =
      !!live &&
      !view.composing &&
      Math.abs((live.top + live.bottom) / 2 - (own.top + own.bottom) / 2) >
        (own.bottom - own.top) / 2;
    const at = live && !offLine ? live : own;
    // In the editor's own units: the document's zoom taken off. Its width
    // unrounded: offsetWidth's whole pixels put the caret off its pixel.
    const r = this.root.getBoundingClientRect();
    const zoom = r.width / parseFloat(getComputedStyle(this.root).width) || 1;
    // One height through a block, from its text size: bold, code, an
    // equation or a fallback font beside the caret doesn't change it.
    let depth = $head.depth;
    while (depth > 0 && !$head.node(depth).isBlock) depth--;
    const block =
      depth > 0 && $head.node(depth).isTextblock
        ? view.nodeDOM($head.before(depth))
        : null;
    const fontSize =
      block instanceof HTMLElement
        ? parseFloat(getComputedStyle(block).fontSize)
        : 0;
    // Beside a picture it stands as tall as the picture, as in Word.
    const { x, y, height, width } = caretBox({
      at,
      picture: this.pictureBeside(),
      fontSize,
      zoom,
      dpr: window.devicePixelRatio || 1,
      root: r,
    });
    // Shown again: it starts where the caret is, not gliding in from
    // where it was last.
    this.caret.classList.toggle("drawn-caret-still", wasHidden);
    this.caret.classList.toggle("drawn-caret-glide", this.glide());
    this.caret.style.transform = `translate(${x}px, ${y}px)`;
    this.caret.style.height = `${height}px`;
    this.caret.style.width = `${width}px`;
    // Each move starts the blink over, solid while the caret moves: a new
    // animation name restarts it without laying the page out again.
    this.blink = !this.blink;
    this.caret.dataset.blink = this.blink ? "a" : "b";
  };

  update() {
    this.schedule();
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    for (const name of MOVES)
      this.view.dom.removeEventListener(name, this.schedule);
    document.removeEventListener("selectionchange", this.schedule);
    this.stopZoom();
    this.resized.disconnect();
    this.root.classList.remove("drawn-caret-on");
    this.caret.remove();
  }
}

export const createDrawnCaretPlugin = (options: {
  enabled: () => boolean;
  glide: () => boolean;
}) =>
  $prose(
    () =>
      new Plugin({
        key: new PluginKey("drawn-caret"),
        view: (view) => new DrawnCaret(view, options.enabled, options.glide),
      }),
  );
