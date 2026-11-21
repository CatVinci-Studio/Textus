import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorState, PluginView } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { holdStill, pageIsTheHands } from "../../engine/controls/scroll-hold";
import { firstBelow, stillPoint } from "./still-point";
import { flushDomSelection } from "../modes/mode-switch";
import {
  DRAW_AHEAD_SCREENS,
  DRAW_SCREENS,
  KEEP_SCREENS,
  PLACEHOLDER_CLASS,
  SETTLE_MS,
} from "./lazy-rules";
import {
  blockNodes,
  fitPlaceholder,
  forgetHeights,
  heightOf,
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

/** Which of the editor's children show which top-level blocks: widgets
 *  between them (a formula's, a diagram's) aren't blocks, so a child's
 *  place says nothing of its block's. One pass, matched in order by node. */
interface BlockElements {
  /** The block index each child shows, or -1 for a widget. */
  blockOf: Int32Array;
  /** The element of each block shown. */
  elementOf: (Element | undefined)[];
}

function blockElements(
  doc: ProseNode,
  children: HTMLCollection,
): BlockElements {
  const blockOf = new Int32Array(children.length).fill(-1);
  const elementOf: (Element | undefined)[] = new Array(doc.childCount);
  let next = 0;
  for (let i = 0; i < children.length && next < doc.childCount; i++) {
    const node = blockNodes.get(children[i]!);
    if (!node || doc.child(next) !== node) continue;
    blockOf[i] = next;
    elementOf[next++] = children[i];
  }
  return { blockOf, elementOf };
}

/** Not shown (a diagram's hidden source): no place to measure from. */
const shown = (el: Element | null, step: (el: Element) => Element | null) => {
  let at = el;
  while (at && !at.getClientRects().length) at = step(at);
  return at;
};

/** The first after `el` with a height of its own to measure by: an empty
 *  one (a formula's hidden source) has margins that fold through it. */
function measurableAfter(
  el: Element | undefined,
  passed: Map<Element, Element | null>,
): Element | null {
  const walked: Element[] = [];
  let at = el?.nextElementSibling ?? null;
  while (at && !passed.has(at) && !at.getBoundingClientRect().height) {
    walked.push(at);
    at = at.nextElementSibling;
  }
  const found = at && passed.has(at) ? passed.get(at)! : at;
  for (const one of walked) passed.set(one, found);
  return found;
}

/** The room a block takes between its neighbours: from the margin's edge
 *  of the one above to that of the one below. A placeholder has no
 *  margins, so the margins it shared with them are its own height. Two
 *  let go together meet at the upper one's margin edge, so a run's rooms
 *  add up to the run and the page keeps its height. */
export function slotOf(
  el: Element,
  rect: DOMRect,
  released: ReadonlySet<Element> = new Set(),
): number {
  const prev = shown(
    el.previousElementSibling,
    (at) => at.previousElementSibling,
  );
  const next = shown(el.nextElementSibling, (at) => at.nextElementSibling);
  const margin = (at: Element, side: "marginTop" | "marginBottom") =>
    parseFloat(getComputedStyle(at)[side]) || 0;
  const start = prev
    ? prev.getBoundingClientRect().bottom + margin(prev, "marginBottom")
    : rect.top - margin(el, "marginTop");
  const end =
    next && !released.has(next)
      ? next.getBoundingClientRect().top - margin(next, "marginTop")
      : rect.bottom + margin(el, "marginBottom");
  return end - start;
}

interface Plan {
  draw: number[];
  release: number[];
}

/** What should change, from the layout as it is now. `releasing`: off
 *  while the page scrolls, those far away let go once it rests. */
export function plan(
  view: EditorView,
  scroller: Element,
  releasing = true,
): Plan | null {
  const state = lazyBlocksKey.getState(view.state);
  if (!state?.active) return null;
  const { doc } = view.state;
  const starts = topLevelStarts(doc);
  const box = scroller.getBoundingClientRect();
  // A tab in the back has no layout: everything would read as on screen.
  if (box.height === 0) return null;
  const screen = box.height;
  const children = view.dom.children;
  const blocks = blockElements(doc, children);

  // Placeholders within the further reach, and whether one is near.
  const draw: number[] = [];
  let near = false;
  const bottom = box.bottom + DRAW_AHEAD_SCREENS * screen;
  for (
    let i = firstBelow(children, box.top - DRAW_AHEAD_SCREENS * screen);
    i < children.length;
    i++
  ) {
    const child = children[i];
    const rect = child.getBoundingClientRect();
    if (rect.top > bottom) break;
    const index = blocks.blockOf[i]!;
    if (index < 0 || !child.classList.contains(PLACEHOLDER_CLASS)) continue;
    draw.push(starts[index]);
    near ||=
      rect.bottom >= box.top - DRAW_SCREENS * screen &&
      rect.top <= box.bottom + DRAW_SCREENS * screen;
  }
  if (!near) draw.length = 0;

  const release: number[] = [];
  const far = KEEP_SCREENS * screen;
  // The caret's blocks stay drawn wherever they are (lazy-blocks-state):
  // let go, they would be drawn again at once, frame after frame.
  const { anchor, head } = view.state.selection;
  const caret = new Set([topLevelIndex(doc, anchor), topLevelIndex(doc, head)]);
  const going: { from: number; el: Element; rect: DOMRect; node: ProseNode }[] =
    [];
  for (const decoration of releasing ? state.drawn.find() : []) {
    const index = topLevelIndex(doc, decoration.from);
    if (caret.has(index)) continue;
    const el = blocks.elementOf[index];
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > box.top - far && rect.top < box.bottom + far) continue;
    going.push({ from: decoration.from, el, rect, node: doc.child(index) });
  }
  const released = new Set(going.map((g) => g.el));
  for (const { from, el, rect, node } of going) {
    rememberHeight(view, node, slotOf(el, rect, released));
    release.push(from);
  }
  if (!draw.length && !release.length) return null;
  return { draw, release };
}

const drawers = new WeakMap<Element, LazyBlocksDrawer>();

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
  private scrolledAt = -Infinity;
  private settle: ReturnType<typeof setTimeout> | undefined;
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
    this.scroller?.addEventListener("scroll", this.onScroll, {
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
    this.scroller?.removeEventListener("scroll", this.onScroll);
    clearTimeout(this.settle);
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

  /** Draws what the layout asks for now, and releases what it no longer
   *  needs once the page rests: every change makes the browser lay out
   *  and restyle a document of thousands of blocks again, and a release
   *  is measured before the frame is drawn. */
  drawNow(): void {
    if (this.view.isDestroyed || !this.scroller || this.holding) return;
    if (performance.now() < this.pausedUntil) return;
    // The scroll's end (onScroll's settle) draws it.
    if (pageIsTheHands(this.scroller)) return;
    // A click's caret not yet read (a busy page hears its selectionchange
    // late) would be overwritten by the old one as the blocks redraw; read
    // before anything is measured, as it may open a block's source.
    flushDomSelection(this.view);
    const scrolling = performance.now() - this.scrolledAt < SETTLE_MS;
    const next = plan(this.view, this.scroller, !scrolling);
    if (!next) return;
    const still = stillPoint(this.view.dom, this.scroller);
    const doc = this.view.state.doc;
    const stillAt = still
      ? blockElements(doc, this.view.dom.children).elementOf.indexOf(still.el)
      : -1;
    // Only what is drawn above it moves what the reader sees: drawn below
    // (reading down), there is nothing to measure before the frame.
    const above =
      stillAt < 0 ||
      still!.el.classList.contains(PLACEHOLDER_CLASS) ||
      next.release.length > 0 ||
      next.draw.some((pos) => topLevelIndex(doc, pos) < stillAt);
    if (next.release.length) this.release(next.release);
    if (next.draw.length) this.change({ draw: next.draw });
    if (!above) return;
    // A placeholder held still is a new element once drawn: its block's.
    holdStill(this.scroller, still, () =>
      stillAt < 0 || this.view.state.doc !== doc
        ? null
        : blockElements(doc, this.view.dom.children).elementOf[stillAt],
    );
  }

  private change(meta: { draw?: number[]; release?: number[] }) {
    this.view.dispatch(
      this.view.state.tr
        .setMeta(lazyBlocksKey, meta)
        .setMeta("addToHistory", false),
    );
  }

  /** Blocks made placeholders of the room they took. Margins a block
   *  shared with its neighbours fold differently around a placeholder, so
   *  where the next block lands corrects each: all read, then written. */
  private release(release: number[]) {
    const { view } = this;
    const root = view.dom;
    const { doc } = view.state;
    const indexes = release.map((pos) => topLevelIndex(doc, pos));
    const before = blockElements(doc, root.children);
    let origin = root.getBoundingClientRect().top;
    // Blocks without height walked past once, not once per release.
    const passedBefore = new Map<Element, Element | null>();
    const was = indexes.map((index) => {
      const below = measurableAfter(before.elementOf[index], passedBefore);
      return below ? below.getBoundingClientRect().top - origin : null;
    });
    this.change({ release });
    const after = blockElements(view.state.doc, root.children);
    origin = root.getBoundingClientRect().top;
    let carried = 0;
    const passedAfter = new Map<Element, Element | null>();
    const fixes = indexes.flatMap((index, i) => {
      const el = after.elementOf[index] as HTMLElement | undefined;
      const below = measurableAfter(el, passedAfter);
      if (!el?.classList.contains(PLACEHOLDER_CLASS) || !below) return [];
      if (was[i] === null) return [];
      const error = below.getBoundingClientRect().top - origin - was[i]!;
      const node = view.state.doc.child(index);
      const height = heightOf(view, node) - (error - carried);
      carried = error;
      return [{ el, node, height }];
    });
    for (const { el, node, height } of fixes)
      fitPlaceholder(view, el, node, height);
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

  /** Scrolled: drawn now, released once it rests. */
  private readonly onScroll = () => {
    this.scrolledAt = performance.now();
    clearTimeout(this.settle);
    this.settle = setTimeout(this.schedule, SETTLE_MS);
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
