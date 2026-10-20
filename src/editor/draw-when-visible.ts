// Drawing deferred until it is near the screen: a formula's KaTeX (a
// diagram waits in mermaid-plugin.ts and registers its draw-all here). A long document holds hundreds of them, and drawing them all
// when it opens is much of what opening costs; the reader sees a screen or
// two of them. Each waits behind a placeholder until an
// IntersectionObserver on its editor's scroller sees it within a screen of
// the view, then draws once. An export or print draws everything still
// waiting first (drawEverything).

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
    // Taken out of the document undrawn (its widget redrawn, the tab
    // closed): nothing to wait for any more.
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
 * Calls `draw` once `el` comes within a screen of where the editor at
 * `editorDom` is scrolled to. `el` is the placeholder, sized to stand in
 * for the drawing; `draw` fills it. Without an IntersectionObserver or a
 * scroller (a test, the playground's page) it draws at once.
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

/** Each editor's way to draw what it holds back that isn't a placeholder
 *  of drawWhenVisible's (its diagrams), by its view.dom. */
const drawAllers = new WeakMap<Element, () => Promise<void>>();

export function registerDrawAll(
  editorDom: Element,
  drawAll: (() => Promise<void>) | null,
): void {
  if (drawAll) drawAllers.set(editorDom, drawAll);
  else drawAllers.delete(editorDom);
}

/** Draws everything in `root` (an editor, or what holds one) still
 *  waiting, for an export or print that copies the page as it is. */
export async function drawEverything(root: Element): Promise<void> {
  const editor = root.matches(".ProseMirror")
    ? root
    : root.querySelector(".ProseMirror");
  const drawAll = editor && drawAllers.get(editor);
  if (drawAll) await drawAll();
  root.querySelectorAll(`[${PENDING_ATTR}]`).forEach(drawNow);
}
