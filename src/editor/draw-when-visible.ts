import { drawAllBlocks } from "./lazy-blocks/lazy-blocks-drawer";

// Drawing deferred until it is near the screen: drawing every formula of a
// long document is much of what opening it costs. An export or print draws
// everything still waiting first.

/** Marks an element still waiting to be drawn. */
export const PENDING_ATTR = "data-draw-pending";

interface Waiting {
  draw: () => void;
  observer: IntersectionObserver;
}

const waiting = new WeakMap<Element, Waiting>();
const observers = new WeakMap<Element, IntersectionObserver>();

function drawNow(el: Element) {
  const entry = waiting.get(el);
  if (!entry) return;
  waiting.delete(el);
  entry.observer.unobserve(el);
  el.removeAttribute(PENDING_ATTR);
  entry.draw();
}

const onIntersect = (entries: IntersectionObserverEntry[]) => {
  for (const { isIntersecting, target } of entries) {
    if (isIntersecting) drawNow(target);
    // Taken out of the document undrawn: nothing to wait for any more.
    else if (!target.isConnected) {
      waiting.get(target)?.observer.unobserve(target);
      waiting.delete(target);
    }
  }
};

/** One observer per scroller, reaching a screen above and below it. */
function observerFor(scroller: Element): IntersectionObserver {
  let observer = observers.get(scroller);
  if (!observer) {
    observer = new IntersectionObserver(onIntersect, {
      root: scroller,
      rootMargin: "100% 0px",
    });
    observers.set(scroller, observer);
  }
  return observer;
}

/**
 * Calls `draw` once the placeholder `el` comes within a screen of the view.
 * Without an IntersectionObserver or a scroller it draws at once.
 */
export function drawWhenVisible(
  el: HTMLElement,
  editorDom: Element,
  draw: () => void,
): void {
  const scroller = editorDom.closest(".editor-scroll");
  if (!scroller || typeof IntersectionObserver === "undefined") {
    draw();
    return;
  }
  const observer = observerFor(scroller);
  waiting.set(el, { draw, observer });
  el.setAttribute(PENDING_ATTR, "");
  observer.observe(el);
}

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
 *  long document's blocks out of sight first, then what is in them. */
export async function drawEverything(root: Element): Promise<void> {
  const editor = root.matches(".ProseMirror")
    ? root
    : root.querySelector(".ProseMirror");
  if (editor) drawAllBlocks(editor);
  const drawAll = editor && drawAllers.get(editor);
  if (drawAll) await drawAll();
  root.querySelectorAll(`[${PENDING_ATTR}]`).forEach(drawNow);
}
