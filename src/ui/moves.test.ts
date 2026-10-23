// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { MARK_CLASS, enter, exit, land } from "./moves";

// jsdom computes no animation, so motionAllowed() is false here: every
// move must end at once in its final state.
describe("moves where nothing moves", () => {
  it("enter starts nothing and exit resolves at once", async () => {
    const el = document.createElement("div");
    expect(enter(el)).toBeNull();
    await expect(exit(el)).resolves.toBeUndefined();
  });

  it("land makes the change at once, with no mark left behind", async () => {
    const old = document.createElement("span");
    const added = document.createElement("span");
    const change = vi.fn(() => [added]);
    await land([old], change);
    expect(change).toHaveBeenCalledOnce();
    expect(old.classList.contains(MARK_CLASS)).toBe(false);
  });
});
