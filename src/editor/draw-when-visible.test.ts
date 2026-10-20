// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PENDING_ATTR,
  drawEverything,
  drawWhenVisible,
  registerDrawAll,
} from "./draw-when-visible";

// A stand-in IntersectionObserver the test drives by hand.
let observed: { el: Element; fire: (hit: boolean) => void }[] = [];
class FakeObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(el: Element) {
    observed.push({
      el,
      fire: (hit) =>
        this.callback(
          [{ isIntersecting: hit, target: el } as IntersectionObserverEntry],
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

describe("drawWhenVisible", () => {
  it("draws at once where nothing can tell what is on screen", () => {
    const draw = vi.fn();
    drawWhenVisible(document.createElement("span"), editorIn(), draw);
    expect(draw).toHaveBeenCalledOnce();
  });

  it("draws once the placeholder comes near the screen, and only once", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const editor = editorIn();
    const el = document.createElement("span");
    editor.append(el);
    const draw = vi.fn();
    drawWhenVisible(el, editor, draw);
    expect(el.hasAttribute(PENDING_ATTR)).toBe(true);
    observed[0].fire(false);
    expect(draw).not.toHaveBeenCalled();
    observed[0].fire(true);
    expect(draw).toHaveBeenCalledOnce();
    expect(el.hasAttribute(PENDING_ATTR)).toBe(false);
    expect(observed).toHaveLength(0);
  });

  it("draws everything still waiting for an export", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const editor = editorIn();
    const els = [1, 2].map(() =>
      editor.appendChild(document.createElement("span")),
    );
    const draw = vi.fn();
    for (const el of els) drawWhenVisible(el, editor, draw);
    const diagrams = vi.fn(async () => {});
    registerDrawAll(editor, diagrams);
    await drawEverything(editor.parentElement!);
    expect(diagrams).toHaveBeenCalledOnce();
    expect(draw).toHaveBeenCalledTimes(2);
    expect(editor.querySelector(`[${PENDING_ATTR}]`)).toBeNull();
  });
});
