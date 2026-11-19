// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  drawEverything,
  drawWhileNear,
  registerDrawAll,
  stopDrawing,
} from "./draw-when-visible";
import { PENDING_ATTR, SETTLE_MS } from "./lazy-rules";

// A stand-in IntersectionObserver the test drives by hand.
let observed: {
  el: Element;
  fire: (...hits: boolean[]) => void;
}[] = [];
class FakeObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(el: Element) {
    observed.push({
      el,
      // Several: one batch of reports for it, oldest first.
      fire: (...hits) =>
        this.callback(
          hits.map(
            (hit) =>
              ({
                isIntersecting: hit,
                target: el,
              }) as IntersectionObserverEntry,
          ),
          this as unknown as IntersectionObserver,
        ),
    });
  }
  unobserve(el: Element) {
    observed = observed.filter((o) => o.el !== el);
  }
  disconnect() {}
}

function editorIn(): HTMLElement {
  const scroller = document.createElement("div");
  scroller.className = "editor-scroll";
  const editor = document.createElement("div");
  editor.className = "ProseMirror";
  scroller.append(editor);
  document.body.append(scroller);
  return editor;
}

afterEach(() => {
  vi.unstubAllGlobals();
  observed = [];
  document.body.replaceChildren();
});

const none = () => {};

/** `el` drawn `top` px below a 500 px screen's top, 40 by 10. */
function placeAt(el: Element, top: number) {
  el.getBoundingClientRect = () =>
    ({ top, bottom: top + 10, left: 0, width: 40, height: 10 }) as DOMRect;
  el.getClientRects = () => [el.getBoundingClientRect()] as never;
}

/** The editor's scroller, a 500 px screen, scrolled. */
function scrolled(editor: HTMLElement) {
  const scroller = editor.parentElement!;
  scroller.getBoundingClientRect = () =>
    ({ top: 0, bottom: 500, height: 500 }) as DOMRect;
  scroller.dispatchEvent(new Event("scroll"));
}

describe("drawWhileNear", () => {
  it("draws at once where nothing can tell what is on screen", () => {
    const draw = vi.fn();
    drawWhileNear(document.createElement("span"), editorIn(), draw, none);
    expect(draw).toHaveBeenCalledOnce();
  });

  it("draws near the screen and lets go only once scrolling rests far from it, keeping its size", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    vi.useFakeTimers();
    const editor = editorIn();
    const el = editor.appendChild(document.createElement("div"));
    const draw = vi.fn();
    const undraw = vi.fn();
    drawWhileNear(el, editor, draw, undraw);
    const [near] = observed;
    expect(el.hasAttribute(PENDING_ATTR)).toBe(true);
    near.fire(false);
    expect(draw).not.toHaveBeenCalled();
    near.fire(true);
    expect(draw).toHaveBeenCalledOnce();
    expect(el.hasAttribute(PENDING_ATTR)).toBe(false);
    // Just past where it was drawn: kept, or a placeholder a few pixels off
    // would be drawn and let go over and over there.
    near.fire(false);
    placeAt(el, 1000);
    scrolled(editor);
    expect(undraw).not.toHaveBeenCalled();
    // Far, and the page at rest.
    placeAt(el, 99_999);
    scrolled(editor);
    expect(undraw).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SETTLE_MS);
    expect(undraw).toHaveBeenCalledOnce();
    expect(el.hasAttribute(PENDING_ATTR)).toBe(true);
    expect(el.style.minHeight).toBe("10px");
    near.fire(true);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(el.style.minHeight).toBe("");
    vi.useRealTimers();
  });

  it("drawn at once, it is still let go far from the screen", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    vi.useFakeTimers();
    const editor = editorIn();
    const el = editor.appendChild(document.createElement("span"));
    const draw = vi.fn();
    const undraw = vi.fn();
    drawWhileNear(el, editor, draw, undraw, true);
    expect(draw).toHaveBeenCalledOnce();
    expect(el.hasAttribute(PENDING_ATTR)).toBe(false);
    observed[0].fire(true);
    expect(draw).toHaveBeenCalledOnce();
    placeAt(el, -99_999);
    scrolled(editor);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(undraw).toHaveBeenCalledOnce();
    // An inline one keeps its width too, so its line doesn't rewrap.
    expect(el.style.display).toBe("inline-block");
    expect(el.style.width).toBe("40px");
    vi.useRealTimers();
  });

  it("there and back in one batch of reports, it is drawn", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const editor = editorIn();
    const el = editor.appendChild(document.createElement("div"));
    const draw = vi.fn();
    drawWhileNear(el, editor, draw, none);
    observed[0].fire(false, true);
    expect(draw).toHaveBeenCalledOnce();
    expect(el.hasAttribute(PENDING_ATTR)).toBe(false);
  });

  it("lets go of one taken out before it was ever near", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const editor = editorIn();
    const el = editor.appendChild(document.createElement("span"));
    drawWhileNear(el, editor, vi.fn(), none);
    expect(observed).toHaveLength(1);
    el.remove();
    stopDrawing(el);
    expect(observed).toHaveLength(0);
  });

  it("draws everything not drawn for an export, its pictures loaded too", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const editor = editorIn();
    const picture = editor.appendChild(document.createElement("img"));
    picture.loading = "lazy";
    const els = [1, 2].map(() =>
      editor.appendChild(document.createElement("span")),
    );
    const draw = vi.fn();
    for (const el of els) drawWhileNear(el, editor, draw, none);
    const diagrams = vi.fn(async () => {});
    registerDrawAll(editor, diagrams);
    await drawEverything(editor.parentElement!);
    expect(diagrams).toHaveBeenCalledOnce();
    expect(draw).toHaveBeenCalledTimes(2);
    expect(editor.querySelector(`[${PENDING_ATTR}]`)).toBeNull();
    // Off screen it would load only once scrolled near: never, for an export.
    expect(picture.loading).toBe("eager");
  });
});
