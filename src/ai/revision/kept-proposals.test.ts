import { describe, expect, it } from "vitest";
import { generatedImageSrc } from "./generated-images";
import {
  KEPT_VERSION,
  keepable,
  keptFrom,
  picturesOf,
  readKept,
  restorable,
} from "./kept-proposals";
import type { PendingPreview } from "./pending-types";

function preview(over: Partial<PendingPreview> = {}): PendingPreview {
  return {
    callId: "c1",
    proposal: { action: "replace", block: "k3f9", text: "New." },
    from: 1,
    to: 9,
    expectedText: "Old one.",
    replacement: "New.",
    ...over,
  };
}

describe("what is kept of a document's proposals", () => {
  const made = () => true;
  const picture = preview({
    proposal: {
      action: "append",
      text: `![a harbour](${generatedImageSrc("img1")})`,
    },
  });

  it("keeps the decidable ones, a picture's once it is made", () => {
    expect(keepable(preview(), made)).toBe(true);
    expect(keepable(preview({ streaming: true }), made)).toBe(false);
    expect(keepable(picture, made)).toBe(true);
    expect(keepable(picture, (id) => id !== "img1")).toBe(false);
  });

  it("names the pictures to keep beside them", () => {
    expect(
      picturesOf(keptFrom([picture, preview()], 1, () => "", made)),
    ).toEqual(["img1"]);
    expect(picturesOf(null)).toEqual([]);
  });

  it("is nothing once nothing is left to decide", () => {
    expect(keptFrom([], 1, () => "", made)).toBeNull();
    expect(
      keptFrom([preview({ streaming: true })], 1, () => "", made),
    ).toBeNull();
  });

  it("keeps where a selection's or the caret's proposal writes, and the calls made so far", () => {
    const kept = keptFrom(
      [
        preview({
          callId: "s",
          proposal: { action: "replace_selection", text: "Shorter." },
          from: 3,
          to: 12,
        }),
        preview({
          callId: "c",
          proposal: { action: "insert_at_cursor", text: "More." },
          from: 7,
          to: 7,
        }),
        preview({
          callId: "r",
          sentences: {
            hunks: [],
            changes: [
              { from: 1, to: 4, before: "A.", after: "B.", take: true },
              { from: 5, to: 9, before: "C.", after: "D.", take: null },
            ],
          },
        }),
      ],
      42,
      (from, to) => `md ${from}-${to}`,
      () => true,
    )!;
    expect(kept.version).toBe(KEPT_VERSION);
    expect(kept.document).toBe(42);
    expect(kept.proposals.map((p) => p.target)).toEqual([
      { range: { from: 3, to: 12 }, selectionMarkdown: "md 3-12" },
      { range: null, selectionMarkdown: null, cursor: 7 },
      undefined,
    ]);
    expect(kept.proposals[2].takes).toEqual([true, null]);
  });
});

describe("what comes back", () => {
  const kept = keptFrom(
    [
      preview({ callId: "anchored" }),
      preview({
        callId: "caret",
        proposal: { action: "insert_at_cursor", text: "More." },
        from: 7,
        to: 7,
      }),
    ],
    42,
    () => "",
    () => true,
  )!;

  it("reads only what this version wrote", () => {
    expect(readKept(null)).toBeNull();
    expect(readKept({ version: 99, proposals: [] })).toBeNull();
    expect(readKept(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
  });

  it("brings a position's proposal back only to the document it was made for", () => {
    expect(restorable(kept, 42).map((p) => p.callId)).toEqual([
      "anchored",
      "caret",
    ]);
    expect(restorable(kept, 7).map((p) => p.callId)).toEqual(["anchored"]);
  });
});
