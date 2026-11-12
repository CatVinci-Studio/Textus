// @vitest-environment jsdom
import { expect, it } from "vitest";
import { noBlocks, showBlocks } from "./live-markdown";

it("keeps the blocks a streaming reply showed and redraws only the last", () => {
  const root = document.createElement("div");
  const shown = noBlocks();
  showBlocks(root, "First paragraph.\n\n- one", shown);
  const first = root.querySelector("p")!;
  showBlocks(root, "First paragraph.\n\n- one\n- two", shown);
  expect(root.querySelector("p")).toBe(first);
  expect(root.querySelectorAll("li")).toHaveLength(2);
  expect(root.querySelectorAll("ul")).toHaveLength(1);
});
