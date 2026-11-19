import { holdStill, stillPoint } from "./hold-still";
import { drawAllBlocks } from "./lazy-blocks-drawer";
import { DRAW_SCREENS, KEEP_SCREENS, PENDING_ATTR } from "./lazy-rules";

// Heavy views (formulas, a plugin's frame) drawn only near the screen and
// let go far from it, so a document's DOM stays the size of a few screens
// however many it holds. An export or print draws everything first.

/** Each editor's way to draw what it holds back outside these placeholders
 *  (its diagrams), by its view.dom. */
const drawAllers = new WeakMap<Element, () => Promise<void>>();

export function registerDrawAll(
  editorDom: Element,
  drawAll: (() => Promise<void>) | null,
): void {
  if (drawAll) drawAllers.set(editorDom, drawAll);
  else drawAllers.delete(editorDom);
}

/** Draws everything in `root` still waiting, for an export or print: a
 *  long document's blocks out of sight first, then what is in them, and
 *  last their pictures, which load only as they come near and would
 *  never be waited for off screen. */
export async function drawEverything(root: Element): Promise<void> {
  const editor = root.matches(".ProseMirror")
    ? root
    : root.querySelector(".ProseMirror");
  if (editor) drawAllBlocks(editor);
  const drawAll = editor && drawAllers.get(editor);
  if (drawAll) await drawAll();
  root.querySelectorAll(`[${PENDING_ATTR}]`).forEach(drawNow);
  for (const img of root.querySelectorAll("img"))
    if (img.loading === "lazy") img.loading = "eager";
}

/** The gap between drawing and letting go keeps one whose placeholder
 *  sits a few pixels from where it sat drawn from being drawn and let go
 *  over and over at the edge, each time moving the page. */
const DRAW_MARGIN = `${DRAW_SCREENS * 100}% 0px`;
const KEEP_MARGIN = `${KEEP_SCREENS * 100}% 0px`;

interface Kept {
  draw: () => void;
  undraw: () => void;
  drawn: boolean;
}

interface Watchers {
  near: IntersectionObserver;
  far: IntersectionObserver;
}

const kept = new WeakMap<Element, Kept>();
const watchers = new WeakMap<Element, Watchers>();

function drawNow(el: Element) {
  const entry = kept.get(el);
  if (!entry || entry.drawn) return;
  entry.drawn = true;
  const box = el as HTMLElement;
  box.style.minHeight = box.style.width = box.style.display = "";
  box.style.boxSizing = box.style.verticalAlign = "";
  el.removeAttribute(PENDING_ATTR);
  entry.draw();
}

/** How far below an inline box's top its baseline sits, by its font:
 *  measured once a font on a probe outside the editor, whose own DOM
 *  isn't to be touched. */
const ascents = new Map<string, number>();
function ascentOf(style: CSSStyleDeclaration): number {
  // WebKit leaves the shorthand empty.
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  let found = ascents.get(font);
  if (found === undefined) {
    const holder = document.createElement("div");
    holder.style.cssText =
      "position:absolute;visibility:hidden;white-space:pre";
    const line = document.createElement("span");
    line.style.font = font;
    const mark = document.createElement("span");
    mark.style.cssText = "display:inline-block;width:0;height:0";
    line.append("x", mark);
    holder.append(line);
    document.body.append(holder);
    found =
      mark.getBoundingClientRect().bottom - line.getBoundingClientRect().top;
    holder.remove();
    ascents.set(font, found);
  }
  return found;
}

/** The box an inline element's line is made to hold for it: its own,
 *  and each box set in the line inside it (an inline-block, as KaTeX
 *  draws), as far as it reaches; what is taken out of the flow (KaTeX's
 *  hidden MathML) left out. */
function reach(box: HTMLElement): DOMRect {
  const outer = box.getBoundingClientRect();
  let top = outer.top;
  let bottom = outer.bottom;
  const walk = (el: Element) => {
    for (const child of el.children) {
      const { position, display } = getComputedStyle(child);
      if (position === "absolute" || position === "fixed") continue;
      if (display === "inline") {
        walk(child);
        continue;
      }
      const r = child.getBoundingClientRect();
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
    }
  };
  walk(box);
  return new DOMRect(outer.left, top, outer.width, bottom - top);
}

/** The size each kept when it goes, so the page and its lines don't
 *  move: a block its height, an inline one its width too, set on the
 *  line where the drawing reached. All read before any is written, or
 *  each write would lay the page out again. */
function holdSizes(boxes: HTMLElement[]) {
  const styles = boxes.map((box) => getComputedStyle(box));
  const inline = styles.map((style) => style.display === "inline");
  const own = boxes.map((box) => box.getBoundingClientRect());
  // An inline drawing reaches past its own line of text (a fraction, a
  // root): held is all of it, what lines it makes taller included.
  const rects = boxes.map((box, i) => (inline[i] ? reach(box) : own[i]!));
  // An empty inline-block rests its bottom on the baseline: lowered by
  // what of the drawing hung below it.
  const lower = styles.map((style, i) =>
    inline[i] ? rects[i]!.bottom - (own[i]!.top + ascentOf(style)) : 0,
  );
  boxes.forEach((box, i) => {
    const rect = rects[i]!;
    if (inline[i]) {
      box.style.display = "inline-block";
      box.style.width = `${rect.width}px`;
      box.style.verticalAlign = `${-lower[i]!}px`;
    }
    // Its padding and border inside the height held, as they were drawn.
    box.style.boxSizing = "border-box";
    box.style.minHeight = `${rect.height}px`;
  });
}

/** Where each reported element is now: gone and back within one batch (a
 *  section folded and opened), only the last report counts. Ones taken out
 *  of the document are let go. */
function latest(
  entries: IntersectionObserverEntry[],
): Map<Element, IntersectionObserverEntry> {
  const now = new Map<Element, IntersectionObserverEntry>();
  for (const entry of entries) now.set(entry.target, entry);
  for (const target of now.keys())
    if (!target.isConnected) {
      stopDrawing(target);
      now.delete(target);
    }
  return now;
}

/** Draws or lets go in the scroller `observer` watches, what is on screen
 *  held where it is. */
function stillWhile(observer: IntersectionObserver, change: () => void) {
  const scroller = observer.root as Element | null;
  const root = scroller?.querySelector(".ProseMirror");
  const still = scroller && root ? stillPoint(root, scroller) : null;
  change();
  if (scroller) holdStill(scroller, still);
}

const onNear = (
  entries: IntersectionObserverEntry[],
  observer: IntersectionObserver,
) => {
  const coming = [...latest(entries)].filter(
    ([target, entry]) => entry.isIntersecting && !kept.get(target)?.drawn,
  );
  if (!coming.length) return;
  const draw = () => coming.forEach(([target]) => drawNow(target));
  // Drawn below the screen, nothing on it moves: no layout read to hold
  // it still, which in a long document costs a whole frame.
  const screen = (observer.root as Element | null)?.getBoundingClientRect();
  const below =
    screen &&
    coming.every(([, entry]) => entry.boundingClientRect.top >= screen.bottom);
  if (below) draw();
  else stillWhile(observer, draw);
  for (const [target] of coming) askAgain(target, "far");
};

/** Each watcher reports only a change: a report that came late (a slow
 *  frame in a fast scroll) may have drawn or let go what the other one
 *  already saw pass. Asked again, it says where the element is now. */
function askAgain(target: Element, which: keyof Watchers) {
  const watcher = watchers.get(target)?.[which];
  watcher?.unobserve(target);
  watcher?.observe(target);
}

/** An inline drawing broken over lines (a long formula) has no one box
 *  to hold: it stays drawn. */
const wraps = (el: Element) => el.getClientRects().length > 1;

/** Let go far away, each holding its exact size: nothing on screen moves,
 *  so nothing is measured after. */
const onFar = (entries: IntersectionObserverEntry[]) => {
  const leaving: HTMLElement[] = [];
  for (const [target, entry] of latest(entries))
    if (!entry.isIntersecting && kept.get(target)?.drawn && !wraps(target))
      leaving.push(target as HTMLElement);
  if (!leaving.length) return;
  holdSizes(leaving);
  for (const target of leaving) {
    kept.get(target)!.drawn = false;
    target.setAttribute(PENDING_ATTR, "");
    kept.get(target)!.undraw();
  }
  for (const target of leaving) askAgain(target, "near");
};

function watchersOf(scroller: Element): Watchers {
  let found = watchers.get(scroller);
  if (!found) {
    found = {
      near: new IntersectionObserver(onNear, {
        root: scroller,
        rootMargin: DRAW_MARGIN,
      }),
      far: new IntersectionObserver(onFar, {
        root: scroller,
        rootMargin: KEEP_MARGIN,
      }),
    };
    watchers.set(scroller, found);
  }
  return found;
}

/**
 * Draws `el` as it comes within a screen of the screen and undraws it again
 * once it is three screens away, its size kept. `now`: drawn at once (on
 * screen, or cheap to draw), and let go the same way. Without an
 * IntersectionObserver or a scroller it draws once and stays.
 */
export function drawWhileNear(
  el: HTMLElement,
  editorDom: Element,
  draw: () => void,
  undraw: () => void,
  now = false,
): void {
  const scroller = editorDom.closest(".editor-scroll");
  if (!scroller || typeof IntersectionObserver === "undefined") {
    draw();
    return;
  }
  const watching = watchersOf(scroller);
  kept.set(el, { draw, undraw, drawn: now });
  watchers.set(el, watching);
  if (now) draw();
  else el.setAttribute(PENDING_ATTR, "");
  watching.near.observe(el);
  watching.far.observe(el);
}

/** Lets go of a placeholder taken out of the document: one that never came
 *  near the screen would otherwise stay observed, its drawing held. */
export function stopDrawing(node: Node): void {
  if (!(node instanceof Element)) return;
  const el = node;
  const watching = watchers.get(el);
  watching?.near.unobserve(el);
  watching?.far.unobserve(el);
  watchers.delete(el);
  kept.delete(el);
}
