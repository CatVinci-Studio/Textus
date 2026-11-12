// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

vi.mock("../motion/motion", () => ({
  motionAllowed: () => true,
  duration: () => 200,
  animate: vi.fn(),
}));

import { Cascade } from "./cascade";

it("keeps a list item's bullet back until its first word comes in", () => {
  const root = document.createElement("div");
  const cascade = new Cascade();
  root.innerHTML = "<p>One two</p><ul><li>Three</li></ul>";
  cascade.play(root);
  // More text arrived: a new item, its words not yet in.
  root.innerHTML = "<p>One two</p><ul><li>Three</li><li></li></ul>";
  cascade.play(root);
  const items = root.querySelectorAll("li");
  expect(items[1].style.opacity).toBe("0");
  expect(items[0].style.opacity).toBe("");
});
