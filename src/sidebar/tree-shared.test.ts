import { describe, expect, it } from "vitest";
import { canMoveInto } from "./tree-shared";

describe("canMoveInto", () => {
  it("refuses a folder moved into itself or anything below it", () => {
    expect(canMoveInto("/w/drafts", true, "/w/drafts")).toBe(false);
    expect(canMoveInto("/w/drafts", true, "/w/drafts/old")).toBe(false);
  });

  it("refuses a move to where it already is", () => {
    expect(canMoveInto("/w/a.md", false, "/w")).toBe(false);
  });

  it("allows a folder into a sibling whose name starts the same", () => {
    expect(canMoveInto("/w/drafts", true, "/w/drafts-2")).toBe(true);
    expect(canMoveInto("/w/drafts/a.md", false, "/w")).toBe(true);
  });
});
