import { describe, expect, it } from "vitest";
import { resolveBlockEdit, splitBlocks } from "./doc-blocks";
import cases from "./doc-blocks-cases.json";

describe("splitBlocks", () => {
  it("splits as doc_blocks.rs does (the shared cases)", () => {
    for (const { document, blocks } of cases)
      expect(
        splitBlocks(document).map((b) => `${b.id} ${b.text}`),
        document,
      ).toEqual(blocks);
  });
});

describe("resolveBlockEdit", () => {
  const doc = "# T\n\nThe cat sat on the mat.\n\nTwo.\n\n---\n\nThree.\n\n---";
  const blocks = splitBlocks(doc);
  const id = (i: number) => blocks[i].id;

  it("makes a block its whole text, and a run its text first to last", () => {
    expect(
      resolveBlockEdit(doc, { action: "replace", block: id(1), text: "A." }),
    ).toEqual({
      action: "replace",
      anchor: "The cat sat on the mat.",
      text: "A.",
    });
    expect(
      resolveBlockEdit(doc, {
        action: "replace",
        block: `#${id(1)}`,
        lastBlock: id(2),
        text: "x",
      })?.anchor,
    ).toBe("The cat sat on the mat.\n\nTwo.");
  });

  it("changes a few words quoted inside a block in the whole block", () => {
    expect(
      resolveBlockEdit(doc, {
        action: "replace",
        block: id(1),
        anchor: "cat",
        text: "do", // still streaming
      }),
    ).toEqual({
      action: "replace",
      anchor: "The cat sat on the mat.",
      text: "The do sat on the mat.",
    });
  });

  it("tells a repeated block apart by the one before, and knows no stale id", () => {
    expect(
      resolveBlockEdit(doc, { action: "delete", block: id(5), text: "" })
        ?.context,
    ).toBe("Three.\n\n---");
    expect(
      resolveBlockEdit(doc, { action: "delete", block: "zzzz", text: "" }),
    ).toBeNull();
    expect(
      resolveBlockEdit(doc, {
        action: "replace",
        block: id(2),
        lastBlock: id(1),
        text: "",
      }),
    ).toBeNull();
  });
});
