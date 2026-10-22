import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import {
  textRange,
  composeMarkdownEdit,
  documentMarkdown,
  matchTarget,
  joinInline,
  type MarkdownBlock,
} from "./doc-markdown";
import { blockIds } from "./doc-blocks";

describe("joinInline", () => {
  it("adds a space between Latin words, none before punctuation, CJK or a footnote ref", () => {
    expect(joinInline("the study", "in 2024")).toBe("the study in 2024");
    expect(joinInline("the study", ", which")).toBe("the study, which");
    expect(joinInline("研究", "表明")).toBe("研究表明");
    expect(joinInline("its last snapshot", "[^2]")).toBe(
      "its last snapshot[^2]",
    );
    expect(joinInline("see", "[the notes](x)")).toBe("see [the notes](x)");
  });
});

/** Builds blocks the way serializeBlocks would, with fake ProseMirror
 *  positions - the matching logic only cares that they're monotonic. */
function blocks(...markdown: string[]): MarkdownBlock[] {
  let offset = 0;
  let pos = 0;
  const ids = blockIds(markdown);
  return markdown.map((md, i) => {
    const block: MarkdownBlock = {
      from: pos,
      to: pos + md.length + 2,
      markdown: md,
      offset,
      id: ids[i],
      kind: "paragraph",
    };
    offset += md.length + 2;
    pos = block.to;
    return block;
  });
}

/** Where `quote` is, named as a model names it: by the blocks it is in -
 *  the one block that holds it, or the run it crosses - and its words. */
function findQuote(doc: MarkdownBlock[], quote: string) {
  const text = documentMarkdown(doc);
  const at = text.indexOf(quote);
  if (at === -1) return null;
  const inBlock = (offset: number) =>
    doc.length - 1 - [...doc].reverse().findIndex((b) => b.offset <= offset);
  const first = inBlock(at);
  const last = inBlock(at + quote.length - 1);
  return matchTarget(doc, {
    block: doc[first].id,
    lastBlock: last > first ? doc[last].id : undefined,
    anchor: quote,
  });
}

describe("documentMarkdown", () => {
  it("joins blocks with a blank line", () => {
    expect(documentMarkdown(blocks("# Title", "Body text"))).toBe(
      "# Title\n\nBody text",
    );
  });
});

describe("matchTarget", () => {
  it("is the block an id names, narrowed to words quoted in it", () => {
    const doc = blocks("This is **important** content");
    const match = matchTarget(doc, {
      block: doc[0].id,
      anchor: "**important**",
    });
    expect(match!.prefix).toBe("This is ");
    expect(match!.suffix).toBe(" content");
    const whole = matchTarget(doc, { block: doc[0].id });
    expect(whole).toEqual({
      from: doc[0].from,
      to: doc[0].to,
      prefix: "",
      suffix: "",
      markdown: "This is **important** content",
    });
  });

  it("snaps the range outward to whole blocks", () => {
    const doc = blocks("First para", "Second para");
    const match = matchTarget(doc, { block: doc[1].id, anchor: "Second" });
    expect(match!.from).toBe(doc[1].from);
    expect(match!.to).toBe(doc[1].to);
    expect(match!.markdown).toBe("Second para");
  });

  it("spans a run of blocks from its first id to its last", () => {
    const doc = blocks("## Heading", "Body", "Tail");
    const match = matchTarget(doc, { block: doc[0].id, lastBlock: doc[1].id });
    expect(match!.from).toBe(doc[0].from);
    expect(match!.to).toBe(doc[1].to);
    expect(match!.markdown).toBe("## Heading\n\nBody");
  });

  // The shape that produced strings of "Couldn't locate that text": prose
  // where the words an edit is about ("GPT 5.6 sol") repeat across
  // paragraphs. The block says which is meant.
  it("tells words that repeat in the document apart by their block", () => {
    const doc = blocks(
      "I used GPT 5.6 sol to build Textus.",
      "Textus brings the **latest LLMs, including GPT 5.6 sol**, to markdown.",
    );
    const match = matchTarget(doc, { block: doc[1].id, anchor: "GPT 5.6 sol" });
    expect(match!.from).toBe(doc[1].from);
    expect(match!.prefix.endsWith("including ")).toBe(true);
  });

  it("is nothing for an id that is gone, or words not in the block once", () => {
    const doc = blocks("a same b same", "c");
    expect(matchTarget(doc, { block: "zzzz" })).toBeNull();
    expect(matchTarget(doc, { block: doc[0].id, anchor: "same" })).toBeNull();
    expect(matchTarget(doc, { block: doc[1].id, anchor: "a" })).toBeNull();
    expect(matchTarget(doc, { anchor: "c" })).toBeNull();
    expect(
      matchTarget(doc, { block: doc[1].id, lastBlock: doc[0].id }),
    ).toBeNull();
  });
});

describe("composeMarkdownEdit", () => {
  const doc = blocks("This is **important** content");
  const match = findQuote(doc, "**important**")!;

  it("preserves surrounding markdown on replace", () => {
    expect(composeMarkdownEdit(match, "replace", "**vital**")).toBe(
      "This is **vital** content",
    );
  });

  it("drops only the snippet on delete", () => {
    expect(composeMarkdownEdit(match, "delete", "")).toBe("This is  content");
  });

  it("inserts mid-sentence text inline, with the space Latin needs", () => {
    expect(composeMarkdownEdit(match, "insert_before", "NEW")).toBe(
      "This is NEW **important** content",
    );
    expect(composeMarkdownEdit(match, "insert_after", "NEW")).toBe(
      "This is **important** NEW content",
    );
    const zh = findQuote(blocks("这项研究很重要"), "研究")!;
    expect(composeMarkdownEdit(zh, "insert_after", "（2024 年）")).toBe(
      "这项研究（2024 年）很重要",
    );
  });

  it("starts a new block for block text or at a block's edge", () => {
    expect(composeMarkdownEdit(match, "insert_after", "- item")).toBe(
      "This is **important**\n\n- item content",
    );
    const para = findQuote(blocks("First para"), "First para")!;
    expect(composeMarkdownEdit(para, "insert_after", "Second para")).toBe(
      "First para\n\nSecond para",
    );
  });

  it("puts a picture after a paragraph's last sentence in a block of its own", () => {
    const para = findQuote(
      blocks("Attendance grew. The Sunday session is cut short."),
      "The Sunday session is cut short.",
    )!;
    expect(
      composeMarkdownEdit(para, "insert_after", "![A hall](assets/hall.png)"),
    ).toBe(
      "Attendance grew. The Sunday session is cut short.\n\n![A hall](assets/hall.png)",
    );
  });

  it("continues the paragraph after its last sentence", () => {
    // Only the whole paragraph as anchor means "a new paragraph after it";
    // its last sentence means "carry the paragraph on".
    const para = findQuote(
      blocks("Attendance grew. The Sunday session is cut short."),
      "The Sunday session is cut short.",
    )!;
    expect(
      composeMarkdownEdit(para, "insert_after", " That needs more staff."),
    ).toBe(
      "Attendance grew. The Sunday session is cut short. That needs more staff.",
    );
    expect(
      composeMarkdownEdit(para, "insert_after", "That needs more staff."),
    ).toBe(
      "Attendance grew. The Sunday session is cut short. That needs more staff.",
    );
  });

  it("keeps a sentence off the edge of a table, heading or list", () => {
    // Only a paragraph carries on past its last sentence: glued on, the
    // sentence would be a third cell, would turn the header row (and so
    // the whole table) into a paragraph, or would join the heading/item.
    const table = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const doc = blocks("## Background", table, "- one\n- two");
    const edit = (
      anchor: string,
      action: "insert_before" | "insert_after",
      text: string,
    ) => composeMarkdownEdit(findQuote(doc, anchor)!, action, text);
    expect(edit("| 1 | 2 |", "insert_after", "Figures are rough.")).toBe(
      `${table}\n\nFigures are rough.`,
    );
    expect(edit("| a | b |", "insert_before", "The table lists it.")).toBe(
      `The table lists it.\n\n${table}`,
    );
    expect(edit("Background", "insert_after", "It explains why.")).toBe(
      "## Background\n\nIt explains why.",
    );
    expect(edit("- two", "insert_after", "That is all.")).toBe(
      "- one\n- two\n\nThat is all.",
    );
    // Away from the edge, a phrase still joins the cell or item.
    expect(edit("one", "insert_after", "(first)")).toBe("- one (first)\n- two");
  });

  it("adds a table row inside the table, not after a blank line", () => {
    const table = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";
    const doc = blocks("Intro", table, "Outro");
    const last = findQuote(doc, "| 3 | 4 |")!;
    expect(composeMarkdownEdit(last, "insert_after", "| 5 | 6 |")).toBe(
      `${table}\n| 5 | 6 |`,
    );
    const middle = findQuote(doc, "| 1 | 2 |")!;
    expect(composeMarkdownEdit(middle, "insert_after", "| 5 | 6 |\n")).toBe(
      "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 5 | 6 |\n| 3 | 4 |",
    );
    expect(composeMarkdownEdit(last, "insert_before", "| 5 | 6 |")).toBe(
      "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 5 | 6 |\n| 3 | 4 |",
    );
  });

  it("adds a nested list item at its parent's depth", () => {
    const list = "- Storage\n  - Snapshots\n- Transport\n  - WebSocket";
    const doc = blocks(list, "After");
    const m = findQuote(doc, "  - WebSocket")!;
    expect(composeMarkdownEdit(m, "insert_after", "  - Long polling")).toBe(
      `${list}\n  - Long polling`,
    );
    // Anchored on the item's text alone, the whole line still decides.
    const text = findQuote(doc, "WebSocket")!;
    expect(composeMarkdownEdit(text, "insert_after", "  - Long polling")).toBe(
      `${list}\n  - Long polling`,
    );
  });

  it("round-trips a heading without losing its level", () => {
    const headings = blocks("## Project Background", "Body");
    const m = findQuote(headings, "## Project Background")!;
    expect(composeMarkdownEdit(m, "replace", "## Background")).toBe(
      "## Background",
    );
  });

  it("keeps the DOCUMENT's whitespace when the quote folded it", () => {
    // The model quoted "## Heading\nBody" for a doc reading
    // "## Heading\n\nBody" - inserting after it must keep the blank line.
    const doc = blocks("## Heading", "Body");
    const m = findQuote(doc, "## Heading\n\nBody")!;
    expect(composeMarkdownEdit(m, "insert_after", "NEW")).toBe(
      "## Heading\n\nBody\n\nNEW",
    );
  });
});

describe("textRange", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "paragraph+" },
      paragraph: { content: "text*" },
      text: {},
    },
  });
  const p = (t: string) => schema.node("paragraph", null, schema.text(t));
  // "one" 0..5 (text 1-4), "two" 5..10 (6-9), "six" 10..15 (11-14)
  const doc = schema.node("doc", null, [p("one"), p("two"), p("six")]);

  it("drops the next paragraph's start a triple click takes in", () => {
    expect(textRange(doc, 6, 11)).toEqual({ from: 6, to: 9 });
  });

  it("drops the previous paragraph's end a selection starts at", () => {
    expect(textRange(doc, 4, 9)).toEqual({ from: 6, to: 9 });
  });

  it("keeps a range across paragraphs, and one inside a paragraph", () => {
    expect(textRange(doc, 2, 8)).toEqual({ from: 2, to: 8 });
    expect(textRange(doc, 1, 14)).toEqual({ from: 1, to: 14 });
    expect(textRange(doc, 6, 8)).toEqual({ from: 6, to: 8 });
  });
});
