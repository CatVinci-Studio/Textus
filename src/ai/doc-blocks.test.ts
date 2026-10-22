import { describe, expect, it } from "vitest";
import {
  blockIds,
  keepPictures,
  resolveBlockEdit,
  resolveBlockTarget,
  runOf,
  textParagraphs,
  type BlockKind,
  type SentBlock,
} from "./doc-blocks";
import keepCases from "./keep-pictures-cases.json";

/** Blocks as serializeBlocks sends them: `[kind, markdown]` each. */
function sent(...blocks: [BlockKind, string][]): SentBlock[] {
  const ids = blockIds(blocks.map(([, markdown]) => markdown));
  return blocks.map(([kind, markdown], i) => ({ id: ids[i], markdown, kind }));
}

describe("blockIds", () => {
  it("are a block's hash, numbered on where the same markdown came before", () => {
    const [a, b, c] = blockIds(["---", "One.", "---"]);
    expect(a).toMatch(/^[0-9a-z]{4}$/);
    expect(b).not.toBe(a);
    expect(c).toBe(`${a}-2`);
    // The same markdown has the same id from one request to the next.
    expect(blockIds(["One."])[0]).toBe(b);
  });
});

describe("runOf", () => {
  const blocks = sent(["paragraph", "A."], ["paragraph", "B."]);
  it("finds a run by its ids, written with or without #", () => {
    expect(runOf(blocks, `#${blocks[0].id}`, blocks[1].id)).toEqual({
      first: 0,
      last: 1,
    });
    expect(runOf(blocks, blocks[1].id, blocks[0].id)).toBeNull();
    expect(runOf(blocks, "zzzz")).toBeNull();
  });
});

describe("resolveBlockEdit", () => {
  const blocks = sent(
    ["heading", "# T"],
    ["paragraph", "The cat sat on the mat."],
    ["list", "- one\n\n- two"],
  );
  const id = (i: number) => blocks[i].id;

  it("makes a block its whole text, and a run its text first to last, keeping the ids", () => {
    expect(
      resolveBlockEdit(blocks, { action: "replace", block: id(1), text: "A." }),
    ).toEqual({
      action: "replace",
      block: id(1),
      anchor: "The cat sat on the mat.",
      text: "A.",
    });
    const run = resolveBlockEdit(blocks, {
      action: "replace",
      block: `#${id(1)}`,
      lastBlock: id(2),
      text: "x",
    });
    // A loose list is one block, its blank line inside it.
    expect(run?.anchor).toBe("The cat sat on the mat.\n\n- one\n\n- two");
    expect(run?.lastBlock).toBe(id(2));
  });

  it("changes a few words quoted inside a block in the whole block", () => {
    expect(
      resolveBlockEdit(blocks, {
        action: "replace",
        block: id(1),
        anchor: "cat",
        text: "do", // still streaming
      }),
    ).toEqual({
      action: "replace",
      block: id(1),
      anchor: "The cat sat on the mat.",
      text: "The do sat on the mat.",
    });
  });

  it("knows no stale id, a backwards run, or words not in the block once", () => {
    expect(
      resolveBlockEdit(blocks, { action: "delete", block: "zzzz", text: "" }),
    ).toBeNull();
    expect(
      resolveBlockEdit(blocks, {
        action: "replace",
        block: id(2),
        lastBlock: id(1),
        text: "",
      }),
    ).toBeNull();
    expect(
      resolveBlockEdit(blocks, {
        action: "replace",
        block: id(1),
        anchor: "dog",
        text: "x",
      }),
    ).toBeNull();
  });
});

describe("resolveBlockTarget", () => {
  const blocks = sent(
    ["heading", "# Title"],
    ["paragraph", "The cat sat on the mat."],
    ["picture", "![Cat](cat.png)"],
    ["paragraph", "The cat sat."],
  );

  it("is the whole block, or a phrase in it - the block saying which", () => {
    expect(resolveBlockTarget(blocks, { block: blocks[1].id })).toEqual({
      block: blocks[1].id,
      anchor: "The cat sat on the mat.",
    });
    expect(
      resolveBlockTarget(blocks, {
        block: blocks[1].id,
        anchor: "The cat sat",
      }),
    ).toEqual({ block: blocks[1].id, anchor: "The cat sat" });
    expect(resolveBlockTarget(blocks, { block: `#${blocks[2].id}` })).toEqual({
      block: blocks[2].id,
      anchor: "![Cat](cat.png)",
    });
  });

  it("is nothing for a block that isn't there, and the quote without one", () => {
    expect(resolveBlockTarget(blocks, { block: "zzzz" })).toBeNull();
    expect(resolveBlockTarget(blocks, { anchor: "mat" })).toEqual({
      anchor: "mat",
    });
    expect(resolveBlockTarget(blocks, {})).toBeNull();
  });
});

describe("keepPictures", () => {
  it("puts back the pictures a rewrite left out, as doc_blocks.rs does (the shared cases)", () => {
    for (const c of keepCases) {
      const run = textParagraphs(c.document).map((p) => ({
        markdown: p.text,
      }));
      expect(keepPictures(run, c.text, c.complete), c.name).toEqual({
        text: c.expected,
        swapped: c.swapped ?? 0,
      });
    }
  });

  it("is what a streaming rewrite of a run is drawn with", () => {
    const blocks = sent(
      ["paragraph", "One."],
      ["picture", "![a](a.png)"],
      ["paragraph", "Two."],
    );
    expect(
      resolveBlockEdit(blocks, {
        action: "replace",
        block: blocks[0].id,
        lastBlock: blocks[2].id,
        text: "Uno.\n\nDos.",
      })?.text,
    ).toBe("Uno.\n\n![a](a.png)\n\nDos.");
  });
});
