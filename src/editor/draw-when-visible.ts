import { drawAllBlocks } from "./lazy-blocks/lazy-blocks-drawer";

// Heavy views (formulas, a plugin's frame) drawn only near the screen and
// let go far from it, so a document's DOM stays the size of a few screens
// however many it holds. An export or print draws everything first.

/** Marks an element not drawn now: not yet, or let go far from the screen. */
export const PENDING_ATTR = "data-draw-pending";

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

/** How far off screen a view is drawn and kept, in screens above and
 *  below. */
const KEEP_MARGIN = "300% 0px";

interface Kept {
  draw: () => void;
  undraw: () => void;
  drawn: boolean;
}

const kept = new WeakMap<Element, Kept>();
const keepObservers = new WeakMap<Element, IntersectionObserver>();

function drawNow(el: Element) {
  const entry = kept.get(el);
  if (!entry || entry.drawn) return;
  entry.drawn = true;
  const box = el as HTMLElement;
  box.style.minHeight = box.style.width = box.style.display = "";
  el.removeAttribute(PENDING_ATTR);
  entry.draw();
}

/** The size each kept when it goes, so the page and its lines don't
 *  move: a block its height, an inline one its width too. All read before
 *  any is written, or each write would lay the page out again. */
function holdSizes(boxes: HTMLElement[]) {
  const sizes = boxes.map((box) => ({
    rect: box.getBoundingClientRect(),
    inline: getComputedStyle(box).display === "inline",
  }));
  boxes.forEach((box, i) => {
    const { rect, inline } = sizes[i]!;
    if (inline) {
      box.style.display = "inline-block";
      box.style.width = `${rect.width}px`;
    }
    box.style.minHeight = `${rect.height}px`;
  });
}

const onKeepIntersect = (entries: IntersectionObserverEntry[]) => {
  // Gone and back within one batch (a section folded and opened): only
  // where each is now counts.
  const latest = new Map<Element, boolean>();
  for (const { isIntersecting, target } of entries)
    latest.set(target, isIntersecting);
  const leaving: HTMLElement[] = [];
  for (const [target, isIntersecting] of latest) {
    const entry = kept.get(target);
    if (!entry) continue;
    if (!target.isConnected) {
      keepObservers.get(target)?.unobserve(target);
      kept.delete(target);
    } else if (isIntersecting) {
      drawNow(target);
    } else if (entry.drawn) {
      leaving.push(target as HTMLElement);
    }
  }
  holdSizes(leaving);
  for (const target of leaving) {
    kept.get(target)!.drawn = false;
    target.setAttribute(PENDING_ATTR, "");
    kept.get(target)!.undraw();
  }
};

/**
 * Draws `el` as it comes near the screen and undraws it again once it is
 * three screens away, its size kept. `now`: drawn at once (on screen, or
 * cheap to draw), and let go the same way. Without an IntersectionObserver
 * or a scroller it draws once and stays.
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
  let observer = keepObservers.get(scroller);
  if (!observer) {
    observer = new IntersectionObserver(onKeepIntersect, {
      root: scroller,
      rootMargin: KEEP_MARGIN,
    });
    keepObservers.set(scroller, observer);
  }
  kept.set(el, { draw, undraw, drawn: now });
  keepObservers.set(el, observer);
  if (now) draw();
  else el.setAttribute(PENDING_ATTR, "");
  observer.observe(el);
}

/** Lets go of a placeholder taken out of the document: one that never came
 *  near the screen would otherwise stay observed, its drawing held. */
export function stopDrawing(node: Node): void {
  if (!(node instanceof Element)) return;
  const el = node;
  keepObservers.get(el)?.unobserve(el);
  keepObservers.delete(el);
  kept.delete(el);
}
