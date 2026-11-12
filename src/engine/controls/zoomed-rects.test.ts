// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { asDrawn, zoomedRectScale } from "./zoomed-rects";
import { setWindowZoom } from "../zoom/tab-zoom";

function element(drawnWidth: number, laidWidth: number): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "offsetWidth", { value: laidWidth });
  el.getBoundingClientRect = () =>
    ({
      width: drawnWidth,
      left: 0,
      top: 0,
      right: drawnWidth,
      bottom: 0,
    }) as DOMRect;
  return el;
}

afterEach(() => setWindowZoom(1));

describe("zoomedRectScale", () => {
  it("leaves boxes alone at 100% and where the engine reports them as drawn", () => {
    expect(zoomedRectScale(element(600, 600))).toBe(1);
    setWindowZoom(1.5);
    expect(zoomedRectScale(element(900, 600))).toBe(1);
  });

  it("scales boxes an engine reports from before the zoom", () => {
    setWindowZoom(1.5);
    expect(zoomedRectScale(element(600, 600))).toBe(1.5);
    expect(
      asDrawn({ left: 100, top: 20, right: 200, bottom: 40 }, 1.5),
    ).toEqual({ left: 150, top: 30, right: 300, bottom: 60 });
  });
});
