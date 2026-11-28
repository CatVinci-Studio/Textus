// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { submenuPlace } from "./placement";

afterEach(() =>
  document.documentElement.style.removeProperty("--ui-text-scale"),
);

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe("submenuPlace", () => {
  it("sits right of its menu, level with its row, the gap growing with the interface", () => {
    const menu = box(100, 100, 200, 300);
    const row = box(100, 150, 200, 30);
    const size = { width: 150, height: 100 };
    expect(submenuPlace(row, menu, size)).toEqual({ left: 304, top: 146 });
    document.documentElement.style.setProperty("--ui-text-scale", "1.25");
    expect(submenuPlace(row, menu, size)).toEqual({ left: 305, top: 145 });
  });

  it("goes left where the window ends", () => {
    const menu = box(window.innerWidth - 220, 100, 200, 300);
    const place = submenuPlace(menu, menu, { width: 150, height: 100 });
    expect(place.left).toBe(menu.left - 4 - 150);
  });

  it("goes the way its menu went: left first, right where the window ends", () => {
    const size = { width: 150, height: 100 };
    const menu = box(400, 100, 200, 300);
    expect(submenuPlace(menu, menu, size, "left").left).toBe(400 - 4 - 150);
    const edge = box(100, 100, 200, 300);
    expect(submenuPlace(edge, edge, size, "left").left).toBe(304);
  });
});
