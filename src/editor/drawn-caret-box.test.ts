import { describe, expect, it } from "vitest";
import { caretBox } from "./drawn-caret-box";

const whole = (v: number, dpr: number) =>
  Math.abs(v * dpr - Math.round(v * dpr)) < 1e-9;

describe("caretBox", () => {
  for (const dpr of [1, 1.5, 2])
    for (const zoom of [0.8, 1, 1.37, 2])
      it(`keeps its width on screen and stands on whole pixels at ${dpr}x, zoom ${zoom}`, () => {
        const root = { left: 10.3, top: 20.7 };
        const box = caretBox({
          at: { top: 101.37, bottom: 119.81, left: 55.55 },
          picture: null,
          fontSize: 16,
          zoom,
          dpr,
          root,
        });
        // Back on screen: the editor's units times the zoom, from its corner.
        const screen = {
          left: root.left + box.x * zoom,
          top: root.top + box.y * zoom,
          width: box.width * zoom,
          height: box.height * zoom,
        };
        expect(screen.width * dpr).toBeCloseTo(Math.round(2 * dpr), 9);
        expect(whole(screen.left, dpr)).toBe(true);
        expect(whole(screen.top, dpr)).toBe(true);
        expect(whole(screen.height, dpr)).toBe(true);
        // Grows with the zoom: the block's text size, 1.25 em.
        expect(screen.height).toBeCloseTo(16 * 1.25 * zoom, 0);
      });

  it("beside a picture stands as tall as it, centred on it", () => {
    const box = caretBox({
      at: { top: 0, bottom: 20, left: 5 },
      picture: { top: 100, height: 80 },
      fontSize: 16,
      zoom: 1,
      dpr: 2,
      root: { left: 0, top: 0 },
    });
    expect(box.height).toBe(80);
    expect(box.y).toBe(100);
  });

  it("without a text size takes the line the browser gave", () => {
    const box = caretBox({
      at: { top: 10, bottom: 30, left: 5 },
      picture: null,
      fontSize: 0,
      zoom: 1,
      dpr: 1,
      root: { left: 0, top: 0 },
    });
    expect(box.height).toBe(20);
    expect(box.y).toBe(10);
  });
});
