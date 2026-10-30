import { describe, expect, it } from "vitest";
import { headingFor } from "./menu-aim";

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  right: left + width,
  bottom: top + height,
});
const parent = box(100, 100, 200, 300);
const right = box(296, 140, 200, 240);
const left = box(-96, 140, 200, 240);

describe("headingFor", () => {
  it("is on its way along the triangle to a submenu on the right", () => {
    expect(
      headingFor({ x: 230, y: 200 }, { x: 260, y: 230 }, parent, right),
    ).toBe(true);
  });

  it("isn't, moving away from the submenu's edge", () => {
    expect(
      headingFor({ x: 260, y: 230 }, { x: 240, y: 300 }, parent, right),
    ).toBe(false);
  });

  it("isn't, outside the triangle below the submenu's reach", () => {
    expect(
      headingFor({ x: 230, y: 200 }, { x: 240, y: 395 }, parent, right),
    ).toBe(false);
  });

  it("isn't, far from the side the submenu is on", () => {
    expect(
      headingFor({ x: 110, y: 200 }, { x: 150, y: 210 }, parent, right),
    ).toBe(false);
  });

  it("follows a submenu flipped to the left", () => {
    expect(
      headingFor({ x: 170, y: 200 }, { x: 140, y: 230 }, parent, left),
    ).toBe(true);
  });
});
