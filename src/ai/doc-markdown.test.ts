import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import {
  textRange,
  composeMarkdownEdit,
  documentMarkdown,
  findMarkdownMatch,
  joinInline,
  type MarkdownBlock,
} from "./doc-markdown";

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
  return markdown.map((md) => {
    const block = { from: pos, to: pos + md.length + 2, markdown: md, offset };
    offset += md.length + 2;
    pos = block.to;
    return block;
  });
}

describe("documentMarkdown", () => {
  it("joins blocks with a blank line", () => {
    expect(documentMarkdown(blocks("# Title", "Body text"))).toBe(
      "# Title\n\nBody text",
    );
  });
});

describe("findMarkdownMatch", () => {
  it("matches a snippet carrying markdown syntax", () => {
    const doc = blocks("This is **important** content");
    const match = findMarkdownMatch(doc, "**important**");
    expect(match).not.toBeNull();
    expect(match!.prefix).toBe("This is ");
    expect(match!.suffix).toBe(" content");
  });

  it("snaps the range outward to whole blocks", () => {
    const doc = blocks("First para", "Second para");
    const match = findMarkdownMatch(doc, "Second");
    // Range covers block 2 entirely, not just the word.
    expect(match!.from).toBe(doc[1].from);
    expect(match!.to).toBe(doc[1].to);
    expect(match!.markdown).toBe("Second para");
  });

  it("spans consecutive blocks when the snippet crosses them", () => {
    const doc = blocks("## Heading", "Body", "Tail");
    const match = findMarkdownMatch(doc, "## Heading\n\nBody");
    expect(match!.from).toBe(doc[0].from);
    expect(match!.to).toBe(doc[1].to);
    expect(match!.prefix).toBe("");
    expect(match!.suffix).toBe("");
  });

  it("rejects an ambiguous snippet", () => {
    expect(findMarkdownMatch(blocks("same", "same"), "same")).toBeNull();
  });

  it("rejects a snippet that isn't there", () => {
    expect(findMarkdownMatch(blocks("hello"), "goodbye")).toBeNull();
  });

  it("rejects an empty snippet rather than matching everywhere", () => {
    expect(findMarkdownMatch(blocks("hello"), "")).toBeNull();
  });

  // The shape that produced strings of "Couldn't locate that text": prose
  // where the natural anchor ("GPT 5.6 sol", "Textus") repeats across
  // paragraphs, so every plain anchor died as ambiguous.
  it("disambiguates a repeated anchor through a unique context", () => {
    const doc = blocks(
      "I used GPT 5.6 sol to build Textus.",
      "Textus brings the **latest LLMs, including GPT 5.6 sol**, to markdown.",
    );
    expect(findMarkdownMatch(doc, "GPT 5.6 sol")).toBeNull();
    const match = findMarkdownMatch(
      doc,
      "GPT 5.6 sol",
      "including GPT 5.6 sol**, to markdown",
    );
    expect(match).not.toBeNull();
    expect(match!.from).toBe(doc[1].from);
    expect(match!.prefix.endsWith("including ")).toBe(true);
  });

  it("rejects a context that is itself absent, repeated, or anchor-free", () => {
    const doc = blocks("a same b", "c same d");
    expect(findMarkdownMatch(doc, "same", "not in the document")).toBeNull();
    expect(findMarkdownMatch(doc, "same", "same")).toBeNull();
    const repeated = blocks("x same y", "x same y");
    expect(findMarkdownMatch(repeated, "same", "x same y")).toBeNull();
  });

  it("tolerates a quote that folded the blank line between blocks", () => {
    const doc = blocks("## Heading", "Body text");
    const match = findMarkdownMatch(doc, "## Heading\nBody text");
    expect(match).not.toBeNull();
    expect(match!.from).toBe(doc[0].from);
    expect(match!.to).toBe(doc[1].to);
  });

  it("keeps the whitespace-tolerant retry unique and word-exact", () => {
    expect(
      findMarkdownMatch(blocks("one two", "one two"), "one\ntwo"),
    ).toBeNull();
    expect(findMarkdownMatch(blocks("onetwo"), "one\ntwo")).toBeNull();
  });
});

describe("composeMarkdownEdit", () => {
  const doc = blocks("This is **important** content");
  const match = findMarkdownMatch(doc, "**important**")!;

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
    const zh = findMarkdownMatch(blocks("这项研究很重要"), "研究")!;
    expect(composeMarkdownEdit(zh, "insert_after", "（2024 年）")).toBe(
      "这项研究（2024 年）很重要",
    );
  });

  it("starts a new block for block text or at a block's edge", () => {
    expect(composeMarkdownEdit(match, "insert_after", "- item")).toBe(
      "This is **important**\n\n- item content",
    );
    const para = findMarkdownMatch(blocks("First para"), "First para")!;
    expect(composeMarkdownEdit(para, "insert_after", "Second para")).toBe(
      "First para\n\nSecond para",
    );
  });

  it("puts a picture after a paragraph's last sentence in a block of its own", () => {
    const para = findMarkdownMatch(
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
    const para = findMarkdownMatch(
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
    ) => composeMarkdownEdit(findMarkdownMatch(doc, anchor)!, action, text);
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
    const last = findMarkdownMatch(doc, "| 3 | 4 |")!;
    expect(composeMarkdownEdit(last, "insert_after", "| 5 | 6 |")).toBe(
      `${table}\n| 5 | 6 |`,
    );
    const middle = findMarkdownMatch(doc, "| 1 | 2 |")!;
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
    const m = findMarkdownMatch(doc, "  - WebSocket")!;
    expect(composeMarkdownEdit(m, "insert_after", "  - Long polling")).toBe(
      `${list}\n  - Long polling`,
    );
    // Anchored on the item's text alone, the whole line still decides.
    const text = findMarkdownMatch(doc, "WebSocket")!;
    expect(composeMarkdownEdit(text, "insert_after", "  - Long polling")).toBe(
      `${list}\n  - Long polling`,
    );
  });

  it("round-trips a heading without losing its level", () => {
    const headings = blocks("## Project Background", "Body");
    const m = findMarkdownMatch(headings, "## Project Background")!;
    expect(composeMarkdownEdit(m, "replace", "## Background")).toBe(
      "## Background",
    );
  });

  it("keeps the DOCUMENT's whitespace when the quote folded it", () => {
    // The model quoted "## Heading\nBody" for a doc reading
    // "## Heading\n\nBody" - inserting after it must keep the blank line.
    const doc = blocks("## Heading", "Body");
    const m = findMarkdownMatch(doc, "## Heading\nBody")!;
    expect(composeMarkdownEdit(m, "insert_after", "NEW")).toBe(
      "## Heading\n\nBody\n\nNEW",
    );
  });
});

describe("findMarkdownMatch typography fallback", () => {
  it("matches a quote whose punctuation differs only typographically", () => {
    const doc = blocks("He said “hello” — twice.", "Then left；quietly.");
    const m = findMarkdownMatch(doc, 'He said "hello" - twice.')!;
    expect(m).not.toBeNull();
    expect(composeMarkdownEdit(m, "replace", "He waved.")).toBe("He waved.");
    expect(findMarkdownMatch(doc, "Then left;quietly.")).not.toBeNull();
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
