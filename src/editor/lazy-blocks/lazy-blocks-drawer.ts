import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorState, PluginView } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  PLACEHOLDER_CLASS,
  blockNodes,
  forgetHeights,
  lazyBlockNodeViews,
  rememberHeight,
} from "./lazy-block-views";
import {
  lazyBlocksKey,
  topLevelIndex,
  topLevelStarts,
} from "./lazy-blocks-state";

// Tells the lazy-blocks plugin what is on screen: placeholders within a
// screen of it get drawn, drawn blocks three screens away go back to
// placeholders of their measured height. Runs once a frame at most, on
// scrolling, resizing and edits; it reads every position first and writes
// (one transaction) after, so the layout is computed once.

/** How far beyond the visible part blocks are drawn, in screens. */
const DRAW_WITHIN = 1;
/** How far drawn blocks stay drawn, in screens: the gap keeps a block
 *  scrolled just past the edge from being made again on the way back. */
const KEEP_WITHIN = 3;
/** Widgets between blocks put a block's element after its index among the
 *  editor's children; this many at most are looked past. */
const WIDGETS_PAST = 8;

/** The first child of `children` whose bottom is below `y`, by binary
 *  search: their tops only grow down the document. */
function firstBelow(children: HTMLCollection, y: number): number {
  let low = 0;
  let high = children.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (children[mid].getBoundingClientRect().bottom < y) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** The index of the top-level block the editor's child `i` shows. */
function blockIndexOf(
  doc: ProseNode,
  i: number,
  node: ProseNode,
): number | null {
  const last = Math.min(i, doc.childCount - 1);
  for (let b = last; b >= Math.max(0, last - WIDGETS_PAST); b--)
    if (doc.child(b) === node) return b;
  return null;
}

/** The element showing top-level block `index`. */
function elementOf(
  children: HTMLCollection,
  index: number,
  node: ProseNode,
): Element | null {
  const end = Math.min(children.length, index + WIDGETS_PAST);
  for (let i = index; i < end; i++)
    if (blockNodes.get(children[i]) === node) return children[i];
  return null;
}

/** A block at the top of the screen and where it was, so drawing blocks
 *  above it (taller or shorter than their estimate) can leave it in place:
 *  WebKit has no CSS scroll anchoring to do it. */
interface Anchor {
  index: number;
  node: ProseNode;
  top: number;
}

export interface Plan {
  draw: number[];
  release: number[];
  anchor: Anchor | null;
}

/** What should change, from the layout as it is now. */
export function plan(view: EditorView, scroller: Element): Plan | null {
  const state = lazyBlocksKey.getState(view.state);
  if (!state?.active) return null;
  const { doc } = view.state;
  const starts = topLevelStarts(doc);
  const box = scroller.getBoundingClientRect();
  // A tab in the back has no layout: everything would read as on screen.
  if (box.height === 0) return null;
  const screen = box.height;
  const children = view.dom.children;

  let anchor: Anchor | null = null;
  const draw: number[] = [];
  const bottom = box.bottom + DRAW_WITHIN * screen;
  for (
    let i = firstBelow(children, box.top - DRAW_WITHIN * screen);
    i < children.length;
    i++
  ) {
    const child = children[i];
    const rect = child.getBoundingClientRect();
    if (rect.top > bottom) break;
    const node = blockNodes.get(child);
    const index = node ? blockIndexOf(doc, i, node) : null;
    if (!node || index === null) continue;
    if (!anchor && rect.bottom >= box.top)
      anchor = { index, node, top: rect.top };
    if (child.classList.contains(PLACEHOLDER_CLASS)) draw.push(starts[index]);
  }

  const release: number[] = [];
  const far = KEEP_WITHIN * screen;
  for (const decoration of state.drawn.find()) {
    const index = topLevelIndex(doc, decoration.from);
    const node = doc.child(index);
    const el = elementOf(children, index, node);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > box.top - far && rect.top < box.bottom + far) continue;
    // Its slot: down to the next block's top, its margins included.
    const next = el.nextElementSibling;
    const height = next
      ? next.getBoundingClientRect().top - rect.top
      : rect.height;
    if (height > 0) rememberHeight(view, node, height);
    release.push(decoration.from);
  }
  if (!draw.length && !release.length) return null;
  return { draw, release, anchor };
}

/** Scrolls by what the anchor moved, once its blocks above changed. */
function keepInPlace(view: EditorView, scroller: Element, anchor: Anchor) {
  const el = elementOf(view.dom.children, anchor.index, anchor.node);
  if (!el) return;
  const moved = el.getBoundingClientRect().top - anchor.top;
  if (Math.abs(moved) >= 0.5) scroller.scrollTop += moved;
}

const drawers = new WeakMap<Element, LazyBlocksDrawer>();

/** About how long the browser's smooth scrollIntoView takes, for holding
 *  the drawer off while one runs. */
export const SMOOTH_SCROLL_MS = 700;

/** Blocks either side of a jump's target drawn before it is measured: a
 *  screen of short paragraphs, so where it lands is drawn as it will be. */
const AROUND_JUMP = 15;

/**
 * Before code measures `pos` to scroll there (the outline, find, a review
 * note): its block and those around it drawn, and nothing else drawn or
 * released for `glideMs` while the scroller glides there, since blocks
 * drawn on the way would move where it lands. Nothing for a short document.
 */
export function drawAround(view: EditorView, pos: number, glideMs = 0): void {
  const drawer = drawers.get(view.dom);
  const state = lazyBlocksKey.getState(view.state);
  if (!drawer || !state?.active) return;
  const { doc } = view.state;
  const starts = topLevelStarts(doc);
  const at = topLevelIndex(doc, Math.min(pos, doc.content.size));
  const draw = starts.slice(
    Math.max(0, at - AROUND_JUMP),
    at + AROUND_JUMP + 1,
  );
  view.dispatch(
    view.state.tr
      .setMeta(lazyBlocksKey, { draw })
      .setMeta("addToHistory", false),
  );
  drawer.pause(glideMs);
}

/**
 * For a jump to a top-level block found in the DOM (the outline's
 * headings): `el` itself when it is drawn, else its block drawn and
 * returned, either way with the blocks around it drawn and the drawer held
 * off for the `glideMs` of the scroll there (see drawAround).
 */
export function drawnForJump(el: Element, glideMs: number): Element | null {
  const root = el.parentElement;
  const drawer = root && drawers.get(root);
  const node = blockNodes.get(el);
  if (!drawer || !node) return el;
  const { view } = drawer;
  const children = view.dom.children;
  const index = blockIndexOf(
    view.state.doc,
    Array.prototype.indexOf.call(children, el),
    node,
  );
  if (index === null) return el;
  drawAround(view, topLevelStarts(view.state.doc)[index], glideMs);
  return elementOf(view.dom.children, index, node);
}

/** Every block of the editor `editorDom` drawn, for an export that copies
 *  the page; kept drawn until the user next scrolls or types. */
export function drawAllBlocks(editorDom: Element): void {
  const drawer = drawers.get(editorDom);
  if (drawer) drawer.drawAll();
}

/** Input that means the user is back at the page, not an export. */
const USER_INPUT = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

export class LazyBlocksDrawer implements PluginView {
  private frame = 0;
  private pausedUntil = 0;
  private resume: ReturnType<typeof setTimeout> | undefined;
  /** Set by drawAll: blocks are drawn, never released, until user input. */
  private holding = false;
  private readonly scroller: Element | null;
  private readonly resize: ResizeObserver | null;
  private width = 0;

  constructor(readonly view: EditorView) {
    this.scroller =
      view.dom.closest(".editor-scroll") ?? view.dom.parentElement;
    this.scroller?.addEventListener("scroll", this.schedule, {
      passive: true,
    });
    this.resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(this.onResize);
    this.resize?.observe(view.dom);
    for (const type of USER_INPUT)
      this.scroller?.addEventListener(type, this.letGo, { passive: true });
    drawers.set(view.dom, this);
    this.schedule();
  }

  update(view: EditorView, previous: EditorState): void {
    const now = lazyBlocksKey.getState(view.state)?.active ?? false;
    const before = lazyBlocksKey.getState(previous)?.active ?? false;
    // Grown past the threshold, or shrunk below: every block's view is
    // decided anew, which only new node views make ProseMirror do.
    if (now !== before) queueMicrotask(this.redraw);
    if (now) this.schedule();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    clearTimeout(this.resume);
    this.scroller?.removeEventListener("scroll", this.schedule);
    for (const type of USER_INPUT)
      this.scroller?.removeEventListener(type, this.letGo);
    this.resize?.disconnect();
    drawers.delete(this.view.dom);
  }

  /** Nothing drawn or released for `ms`; then what the screen shows. */
  pause(ms: number): void {
    if (ms <= 0) return;
    this.pausedUntil = performance.now() + ms;
    clearTimeout(this.resume);
    this.resume = setTimeout(this.schedule, ms);
  }

  drawAll(): void {
    if (!lazyBlocksKey.getState(this.view.state)?.active) return;
    this.holding = true;
    this.view.dispatch(
      this.view.state.tr
        .setMeta(lazyBlocksKey, { drawAll: true })
        .setMeta("addToHistory", false),
    );
  }

  /** Draws and releases what the layout asks for now, at once. */
  drawNow(): void {
    if (this.view.isDestroyed || !this.scroller || this.holding) return;
    if (performance.now() < this.pausedUntil) return;
    const next = plan(this.view, this.scroller);
    if (!next) return;
    this.view.dispatch(
      this.view.state.tr
        .setMeta(lazyBlocksKey, { draw: next.draw, release: next.release })
        .setMeta("addToHistory", false),
    );
    if (next.anchor) keepInPlace(this.view, this.scroller, next.anchor);
  }

  private readonly redraw = () => {
    if (this.view.isDestroyed) return;
    this.view.setProps({
      nodeViews: lazyBlockNodeViews(
        this.view.state.schema,
        this.view.props.nodeViews ?? {},
      ),
    });
  };

  private readonly letGo = () => {
    if (!this.holding) return;
    this.holding = false;
    this.schedule();
  };

  private readonly onResize = (entries: ResizeObserverEntry[]) => {
    const width = entries[0]?.contentRect.width ?? 0;
    // Hidden (a tab in the back) changes nothing it measured.
    if (width === 0 || width === this.width) return;
    if (this.width) forgetHeights(this.view);
    this.width = width;
    this.schedule();
  };

  private readonly schedule = () => {
    if (this.frame || !this.scroller) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.drawNow();
    });
  };
}
