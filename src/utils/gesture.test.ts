// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { heldByFinger } from "./gesture";

function contextmenu(pointerType?: string, button = 0) {
  const e = new MouseEvent("contextmenu", { button });
  if (pointerType)
    Object.defineProperty(e, "pointerType", { value: pointerType });
  return e;
}

describe("a contextmenu held by a finger", () => {
  it("is told by its pointer type where the event has one", () => {
    expect(heldByFinger(contextmenu("touch"))).toBe(true);
    expect(heldByFinger(contextmenu("mouse"))).toBe(false);
  });

  it("is a handle let go when it has no button, long after the touch", () => {
    expect(heldByFinger(contextmenu("mouse", -1))).toBe(true);
    expect(heldByFinger(contextmenu("mouse", 2))).toBe(false);
  });

  it("else by a touch just before it", () => {
    expect(heldByFinger(contextmenu())).toBe(false);
    const down = new Event("pointerdown");
    Object.defineProperty(down, "pointerType", { value: "touch" });
    window.dispatchEvent(down);
    expect(heldByFinger(contextmenu())).toBe(true);
    // Android's double tap and handle drag come as "mouse" ones.
    expect(heldByFinger(contextmenu("mouse"))).toBe(true);
    expect(heldByFinger(contextmenu("pen"))).toBe(false);
  });
});
