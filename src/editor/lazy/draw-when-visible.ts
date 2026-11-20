import { holdStill, pastAnEnd, stillPoint } from "./hold-still";
import { drawAllBlocks } from "./lazy-blocks-drawer";
import {
  DRAW_SCREENS,
  KEEP_SCREENS,
  PENDING_ATTR,
  SETTLE_MS,
} from "./lazy-rules";

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

/** Drawn within a screen of the screen, by the observer's margin. */
const DRAW_MARGIN = `${DRAW_SCREENS * 100}% 0px`;

interface Kept {
  draw: () => void;
  undraw: () => void;
  drawn: boolean;
}

/** One scroller's views: an observer that draws them as they come near,
 *  and a timer that lets go of the far ones once scrolling rests. */
interface Watchers {
  near: IntersectionObserver;
  views: Set<Element>;
  rest: ReturnType<typeof setTimeout> | undefined;
}

const kept = new WeakMap<Element, Kept>();
/** By scroller, and by each view in it. */
const watchers = new WeakMap<Element, Watchers>();

function drawNow(el: Element) {
  const entry = kept.get(el);
  if (!entry || entry.drawn) return;
  entry.drawn = true;
  const box = el as HTMLElement;
  box.style.minHeight = box.style.boxSizing = "";
  el.removeAttribute(PENDING_ATTR);
  entry.draw();
}

/** The height each kept when it goes, so the page doesn't move. All read
 *  before any is written, or each write would lay the page out again. */
function holdSizes(boxes: HTMLElement[]) {
  const heights = boxes.map((box) => box.getBoundingClientRect().height);
  boxes.forEach((box, i) => {
    // Its padding and border inside the height held, as they were drawn.
    box.style.boxSizing = "border-box";
    box.style.minHeight = `${heights[i]}px`;
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

/** Draws in the scroller `observer` watches, what is on screen held where
 *  it is. Pulled past an end, the page can't be held, so it waits for the
 *  scroll heard when the page comes to rest. */
function stillWhile(observer: IntersectionObserver, change: () => void) {
  const scroller = observer.root as Element | null;
  if (scroller && pastAnEnd(scroller)) {
    scroller.addEventListener("scroll", () => stillWhile(observer, change), {
      once: true,
      passive: true,
    });
    return;
  }
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
};

/** An inline drawing (a formula in a line) stays once drawn: the line
 *  it sets can't be held exactly without it, and a block far away is let
 *  go whole, its lines with it. */
const inline = (el: Element) => getComputedStyle(el).display === "inline";

/** Lets go of the views drawn far from the screen, each holding its exact
 *  size, so nothing on screen moves. Where each is, is read at rest: an
 *  observer's report of leaving can wait for the next paint, which a
 *  scrolled box (WebKit on Linux) may not ask for. */
function letGoFar(scroller: Element, watching: Watchers) {
  const screen = scroller.getBoundingClientRect();
  const reach = KEEP_SCREENS * screen.height;
  const leaving: HTMLElement[] = [];
  for (const el of watching.views) {
    if (!el.isConnected) {
      stopDrawing(el);
      continue;
    }
    if (!kept.get(el)?.drawn) continue;
    const rect = el.getBoundingClientRect();
    const far =
      rect.bottom < screen.top - reach || rect.top > screen.bottom + reach;
    if (far && !inline(el)) leaving.push(el as HTMLElement);
  }
  if (!leaving.length) return;
  // Each holds its size, but WebKit may still scroll as their insides go.
  stillWhile(watching.near, () => {
    holdSizes(leaving);
    for (const target of leaving) {
      kept.get(target)!.drawn = false;
      target.setAttribute(PENDING_ATTR, "");
      kept.get(target)!.undraw();
    }
  });
}

/** Lets go of what is far once nothing has scrolled for a while. */
function letGoAtRest(scroller: Element) {
  const watching = watchers.get(scroller);
  if (!watching) return;
  clearTimeout(watching.rest);
  watching.rest = setTimeout(() => letGoFar(scroller, watching), SETTLE_MS);
}

function watchersOf(scroller: Element): Watchers {
  let found = watchers.get(scroller);
  if (!found) {
    const watching: Watchers = {
      near: new IntersectionObserver(onNear, {
        root: scroller,
        rootMargin: DRAW_MARGIN,
      }),
      views: new Set(),
      rest: undefined,
    };
    scroller.addEventListener("scroll", () => letGoAtRest(scroller), {
      passive: true,
    });
    watchers.set(scroller, watching);
    found = watching;
  }
  return found;
}

/**
 * Draws `el` as it comes within a screen of the screen and undraws it again
 * once scrolling rests with it four screens away, its size kept. `now`: drawn at once (on
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
  // Drawn at once wherever it is (a formula drawn before, its view made
  // again as the blocks around it change): let go if that is far.
  if (now) {
    draw();
    letGoAtRest(scroller);
  } else el.setAttribute(PENDING_ATTR, "");
  watching.views.add(el);
  watching.near.observe(el);
}

/** Lets go of a placeholder taken out of the document: one that never came
 *  near the screen would otherwise stay observed, its drawing held. */
export function stopDrawing(node: Node): void {
  if (!(node instanceof Element)) return;
  const el = node;
  const watching = watchers.get(el);
  watching?.near.unobserve(el);
  watching?.views.delete(el);
  watchers.delete(el);
  kept.delete(el);
}
