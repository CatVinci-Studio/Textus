// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PENDING_ATTR,
  drawEverything,
  drawWhileNear,
  registerDrawAll,
  stopDrawing,
} from "./draw-when-visible";

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

describe("drawWhileNear", () => {
  it("draws at once where nothing can tell what is on screen", () => {
    const draw = vi.fn();
    drawWhileNear(document.createElement("span"), editorIn(), draw, none);
    expect(draw).toHaveBeenCalledOnce();
  });

  it("draws near the screen and lets go far from it, keeping its size", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const editor = editorIn();
    const el = editor.appendChild(document.createElement("div"));
    const draw = vi.fn();
    const undraw = vi.fn();
    drawWhileNear(el, editor, draw, undraw);
    expect(el.hasAttribute(PENDING_ATTR)).toBe(true);
    observed[0].fire(false);
    expect(draw).not.toHaveBeenCalled();
    expect(undraw).not.toHaveBeenCalled();
    observed[0].fire(true);
    expect(draw).toHaveBeenCalledOnce();
    expect(el.hasAttribute(PENDING_ATTR)).toBe(false);
    observed[0].fire(false);
    expect(undraw).toHaveBeenCalledOnce();
    expect(el.hasAttribute(PENDING_ATTR)).toBe(true);
    expect(el.style.minHeight).toBe("0px");
    observed[0].fire(true);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(el.style.minHeight).toBe("");
  });

  it("drawn at once, it is still let go far from the screen", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const editor = editorIn();
    const el = editor.appendChild(document.createElement("span"));
    const draw = vi.fn();
    const undraw = vi.fn();
    drawWhileNear(el, editor, draw, undraw, true);
    expect(draw).toHaveBeenCalledOnce();
    expect(el.hasAttribute(PENDING_ATTR)).toBe(false);
    observed[0].fire(true);
    expect(draw).toHaveBeenCalledOnce();
    observed[0].fire(false);
    expect(undraw).toHaveBeenCalledOnce();
    // An inline one keeps its width too, so its line doesn't rewrap.
    expect(el.style.display).toBe("inline-block");
    expect(el.style.width).toBe("0px");
  });

  it("gone and back in one batch, it stays drawn", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const editor = editorIn();
    const el = editor.appendChild(document.createElement("div"));
    const undraw = vi.fn();
    drawWhileNear(el, editor, vi.fn(), undraw, true);
    observed[0].fire(false, true);
    expect(undraw).not.toHaveBeenCalled();
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
