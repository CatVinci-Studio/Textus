import { describe, expect, it } from "vitest";
import {
  keepPictures,
  resolveBlockEdit,
  resolveBlockTarget,
  splitBlocks,
} from "./doc-blocks";
import cases from "./doc-blocks-cases.json";
import keepCases from "./keep-pictures-cases.json";

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

describe("resolveBlockTarget", () => {
  const doc =
    "# Title\n\nThe cat sat on the mat.\n\n![Cat](cat.png)\n\nThe cat sat.";
  const ids = splitBlocks(doc).map((b) => b.id);

  it("is the whole block, or a phrase in it pinned by the block", () => {
    expect(resolveBlockTarget(doc, { block: ids[1] })).toEqual({
      anchor: "The cat sat on the mat.",
    });
    expect(
      resolveBlockTarget(doc, { block: ids[1], anchor: "The cat sat" }),
    ).toEqual({ anchor: "The cat sat", context: "The cat sat on the mat." });
    expect(resolveBlockTarget(doc, { block: `#${ids[2]}` })).toEqual({
      anchor: "![Cat](cat.png)",
    });
  });

  it("is nothing for a block that isn't there, and the quote without one", () => {
    expect(resolveBlockTarget(doc, { block: "zzzz" })).toBeNull();
    expect(resolveBlockTarget(doc, { anchor: "mat" })).toEqual({
      anchor: "mat",
    });
    expect(resolveBlockTarget(doc, {})).toBeNull();
  });
});

describe("keepPictures", () => {
  it("puts back the pictures a rewrite left out, as doc_blocks.rs does (the shared cases)", () => {
    for (const c of keepCases)
      expect(
        keepPictures(splitBlocks(c.document), c.text, c.complete),
        c.name,
      ).toEqual({ text: c.expected, swapped: c.swapped ?? 0 });
  });

  it("is what a streaming rewrite of a run is drawn with", () => {
    const doc = "One.\n\n![a](a.png)\n\nTwo.";
    const blocks = splitBlocks(doc);
    expect(
      resolveBlockEdit(doc, {
        action: "replace",
        block: blocks[0].id,
        lastBlock: blocks[2].id,
        text: "Uno.\n\nDos.",
      })?.text,
    ).toBe("Uno.\n\n![a](a.png)\n\nDos.");
  });
});
