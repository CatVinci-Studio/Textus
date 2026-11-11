import { describe, expect, it } from "vitest";
import { nextFocusAfterChange, orderForReview } from "./pending-edit-focus";
import { type PendingPreview } from "./pending-types";

function preview(callId: string, from: number, streaming?: boolean) {
  return {
    callId,
    proposal: { action: "replace" },
    from,
    to: from + 1,
    expectedText: "",
    replacement: "",
    streaming,
  } as PendingPreview;
}

describe("orderForReview", () => {
  it("sorts by document position, not arrival order", () => {
    const previews = [preview("c", 30), preview("a", 10), preview("b", 20)];
    expect(orderForReview(previews).map((p) => p.callId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("excludes previews still streaming in", () => {
    const previews = [preview("a", 10), preview("b", 20, true)];
    expect(orderForReview(previews).map((p) => p.callId)).toEqual(["a"]);
  });
});

describe("nextFocusAfterChange", () => {
  it("keeps the same focus when it is still present", () => {
    expect(nextFocusAfterChange(["a", "b", "c"], "b", ["a", "b", "c"])).toBe(
      "b",
    );
  });

  it("advances to what is now at the same index when the middle item leaves", () => {
    // Reviewing c (index 2) of [a,b,c,d,e]; accepting c should land on d,
    // not restart at a.
    expect(
      nextFocusAfterChange(["a", "b", "c", "d", "e"], "c", [
        "a",
        "b",
        "d",
        "e",
      ]),
    ).toBe("d");
  });

  it("falls back to the new last item when the last item leaves", () => {
    expect(nextFocusAfterChange(["a", "b", "c"], "c", ["a", "b"])).toBe("b");
  });

  it("returns null once the list empties", () => {
    expect(nextFocusAfterChange(["a"], "a", [])).toBeNull();
  });

  it("picks the first item when there was no prior focus", () => {
    expect(nextFocusAfterChange([], null, ["a", "b"])).toBe("a");
  });

  it("picks the first item when the old focus is unrecognized", () => {
    expect(nextFocusAfterChange(["x"], "stale", ["a", "b"])).toBe("a");
  });
});
