import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import "./drawn-caret.css";

/**
 * The caret drawn in place of the system's, so it can glide (Smooth caret):
 * only for a caret with nothing selected, in a focused editor, and not while
 * an input method composes (its own caret shows then). Placed once a frame
 * at most.
 */
/** The caret's height, in the block's text size. */
const CARET_EM = 1.25;
/** Its width on screen, whatever the document's zoom. */
const CARET_PX = 2;

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
    this.caret.hidden = true;
    this.root.append(this.caret);
    for (const name of ["focus", "blur", "compositionstart", "compositionend"])
      view.dom.addEventListener(name, this.schedule);
  }

  private readonly schedule = () => {
    if (!this.frame) this.frame = requestAnimationFrame(this.place);
  };

  private readonly place = () => {
    this.frame = 0;
    const { view } = this;
    const on =
      this.enabled() &&
      view.editable &&
      view.hasFocus() &&
      view.state.selection.empty &&
      !view.composing;
    this.root.classList.toggle("drawn-caret-on", on);
    const wasHidden = this.caret.hidden;
    this.caret.hidden = !on;
    if (!on) return;
    const { $head } = view.state.selection;
    const at = view.coordsAtPos($head.pos);
    // In the editor's own units: the document's zoom taken off.
    const r = this.root.getBoundingClientRect();
    // Its width unrounded: offsetWidth's whole pixels put the caret off
    // the pixel it was snapped to.
    const zoom = r.width / parseFloat(getComputedStyle(this.root).width) || 1;
    // One height through a block, from its text size: bold, code, an
    // equation or a fallback font beside the caret doesn't change it.
    let depth = $head.depth;
    while (depth > 0 && !$head.node(depth).isBlock) depth--;
    const block =
      depth > 0 && $head.node(depth).isTextblock
        ? view.nodeDOM($head.before(depth))
        : null;
    const height =
      block instanceof HTMLElement
        ? parseFloat(getComputedStyle(block).fontSize) * CARET_EM
        : (at.bottom - at.top) / zoom;
    // On whole screen pixels, its width the same at any zoom: in between,
    // or grown with the zoom, it drew thick and soft.
    const dpr = window.devicePixelRatio || 1;
    const onPixel = (v: number) => Math.round(v * dpr) / dpr;
    const x = (onPixel(at.left) - r.left) / zoom;
    const width = Math.max(1, Math.round(CARET_PX * dpr)) / dpr / zoom;
    const y = ((at.top + at.bottom) / 2 - r.top) / zoom - height / 2;
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
    for (const name of ["focus", "blur", "compositionstart", "compositionend"])
      this.view.dom.removeEventListener(name, this.schedule);
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
