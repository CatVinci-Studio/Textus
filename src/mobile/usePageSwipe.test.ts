import { describe, expect, it } from "vitest";
import { swipeTurnsPage } from "./usePageSwipe";

const width = 430;

describe("an edge swipe between the phone's pages", () => {
  it("opens Textus AI from the right edge, leftwards", () => {
    expect(
      swipeTurnsPage({ x: 420, y: 300 }, { x: 300, y: 310 }, width, false),
    ).toBe(true);
  });
  it("goes back from the left edge, rightwards", () => {
    expect(
      swipeTurnsPage({ x: 10, y: 300 }, { x: 140, y: 300 }, width, true),
    ).toBe(true);
  });
  it("ignores a swipe that starts inside the page", () => {
    expect(
      swipeTurnsPage({ x: 200, y: 300 }, { x: 60, y: 300 }, width, false),
    ).toBe(false);
  });
  it("ignores a short or mostly vertical move", () => {
    expect(
      swipeTurnsPage({ x: 420, y: 300 }, { x: 380, y: 300 }, width, false),
    ).toBe(false);
    expect(
      swipeTurnsPage({ x: 420, y: 300 }, { x: 330, y: 500 }, width, false),
    ).toBe(false);
  });
  it("closes an iPad's docked panel from the panel's own edge", () => {
    expect(
      swipeTurnsPage({ x: 700, y: 300 }, { x: 830, y: 300 }, 1024, true, 690),
    ).toBe(true);
    expect(
      swipeTurnsPage({ x: 10, y: 300 }, { x: 140, y: 300 }, 1024, true, 690),
    ).toBe(false);
  });

  it("ignores the wrong direction for the page showing", () => {
    expect(
      swipeTurnsPage({ x: 10, y: 300 }, { x: 140, y: 300 }, width, false),
    ).toBe(false);
  });
});
