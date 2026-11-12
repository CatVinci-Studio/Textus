// @vitest-environment jsdom
import { expect, it } from "vitest";
import { arrangementOf } from "./app-bridge";
import { pairLayout } from "../engine/layout/ops";

it("tells plugins of a new arrangement, not of a divider moved", () => {
  const split = pairLayout("row", "a", "b");
  const moved = { ...split, root: { ...split.root, sizes: [0.3, 0.7] } };
  expect(arrangementOf(moved)).toBe(arrangementOf(split));
  const swapped = {
    ...split,
    root: { ...split.root, children: [...split.root.children].reverse() },
  };
  expect(arrangementOf(swapped)).not.toBe(arrangementOf(split));
});
