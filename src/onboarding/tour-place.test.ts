import { describe, expect, it } from "vitest";
import { holeAround, placeCard } from "./tour-place";

const view = { width: 1200, height: 800 };
const card = { width: 300, height: 160 };

describe("the tour's hole and card", () => {
  it("pads the hole and keeps it in the window", () => {
    expect(
      holeAround({ left: 2, top: 10, width: 40, height: 40 }, view),
    ).toEqual({ left: 0, top: 4, width: 48, height: 52 });
  });

  it("sets the card beside the hole, else in the middle", () => {
    const rail = { left: 0, top: 100, width: 48, height: 48 };
    expect(placeCard(rail, card, view, false)).toEqual({ left: 64, top: 44 });
    // At the right edge it goes to the left.
    const ai = { left: 1150, top: 4, width: 40, height: 40 };
    expect(placeCard(ai, card, view, false).left).toBe(1150 - 16 - 300);
    expect(placeCard(null, card, view, false)).toEqual({ left: 450, top: 320 });
  });

  it("on a phone, keeps the card off a low hole", () => {
    const phone = { width: 390, height: 840 };
    const low = { left: 0, top: 600, width: 390, height: 200 };
    expect(placeCard(low, card, phone, true).top).toBe(600 - 16 - 160);
    const high = { left: 0, top: 40, width: 40, height: 40 };
    expect(placeCard(high, card, phone, true).top).toBe(96);
  });
});
