// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  Fragment,
  Schema,
  Slice,
  type Node as ProseNode,
} from "@milkdown/kit/prose/model";
import { tableNodes } from "@milkdown/kit/prose/tables";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { keepPastedBlock, keepPastedSpans } from "./paste-markdown-plugin";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    md_span: {
      content: "inline*",
      group: "inline",
      inline: true,
      attrs: { rung: { default: 2 } },
    },
    md_code_span: { content: "text*", group: "inline", inline: true },
    text: { group: "inline" },
  },
});

const bold = (...text: string[]) =>
  schema.node(
    "md_span",
    null,
    text.map((t) => schema.text(t)),
  );
const italic = (text: string) =>
  schema.node("md_span", { rung: 1 }, [schema.text(text)]);
const code = (text: string) =>
  schema.node("md_code_span", null, [schema.text(text)]);

/** A selection at `pos` in "x" + `inside` + "y". */
function caretIn(inside: ReturnType<typeof bold> | null, pos: number) {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("x"),
      ...(inside ? [inside] : []),
      schema.text("y"),
    ]),
  ]);
  return TextSelection.create(EditorState.create({ doc }).doc, pos);
}

/** Pasted "**bold `code`** text **end**", opened as deep as it goes. */
const pasted = Slice.maxOpen(
  schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.node("md_span", null, [schema.text("bold "), code("code")]),
      schema.text(" text "),
      bold("end"),
    ]),
  ]).content,
);

describe("keepPastedSpans", () => {
  it("closes the spans at a paste's ends in a paragraph", () => {
    expect([pasted.openStart, pasted.openEnd]).toEqual([2, 2]);
    const slice = keepPastedSpans(pasted, caretIn(null, 2));
    expect([slice.openStart, slice.openEnd]).toEqual([1, 1]);
    expect(slice.content).toBe(pasted.content);
  });

  it("leaves a span open inside a span just like it", () => {
    // Pasted in the middle of bold: the bold at each end joins it.
    const slice = keepPastedSpans(pasted, caretIn(bold("ab"), 3));
    expect([slice.openStart, slice.openEnd]).toEqual([2, 2]);
  });

  it("closes a span inside a span of another kind", () => {
    const slice = keepPastedSpans(pasted, caretIn(italic("ab"), 3));
    expect([slice.openStart, slice.openEnd]).toEqual([1, 1]);
  });

  it("leaves a paste with no span at its ends as it was", () => {
    const plain = Slice.maxOpen(
      schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("a "),
          bold("b"),
          schema.text(" c"),
        ]),
      ]).content,
    );
    expect(keepPastedSpans(plain, caretIn(null, 2))).toBe(plain);
  });
});

describe("keepPastedBlock", () => {
  const cells = tableNodes({
    tableGroup: "block",
    cellContent: "paragraph",
    cellAttributes: {},
  });
  const blocks = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "text*" },
      blockquote: { group: "block", content: "block+" },
      code_block: { group: "block", content: "text*", code: true },
      frontmatter: { group: "block", content: "text*", code: true },
      text: { group: "inline" },
      ...cells,
    },
  });
  const b = blocks.nodes;
  const para = (text = "") =>
    b.paragraph.create(null, text ? blocks.text(text) : null);
  const pasted = (node: ProseNode) => Slice.maxOpen(Fragment.from(node));
  /** The caret at the end of the first textblock in `doc`. */
  const caret = (doc: ProseNode) => {
    let pos = -1;
    doc.descendants((node, offset) => {
      if (pos < 0 && node.isTextblock) pos = offset + 1 + node.content.size;
      return pos < 0;
    });
    return doc.resolve(pos);
  };
  const quoted = pasted(b.blockquote.create(null, para("q")));
  const code = pasted(b.code_block.create(null, blocks.text("x")));

  it("closes a quote or code block landing on an empty line", () => {
    const $pos = caret(b.doc.create(null, para()));
    expect(keepPastedBlock(quoted, $pos, false).openStart).toBe(0);
    expect(keepPastedBlock(code, $pos, false).openStart).toBe(0);
  });

  it("on a line with text, only for pasted Markdown, at both ends", () => {
    const $pos = caret(b.doc.create(null, para("text")));
    expect(keepPastedBlock(code, $pos, false)).toBe(code);
    const kept = keepPastedBlock(code, $pos, true);
    expect([kept.openStart, kept.openEnd]).toEqual([0, 0]);
  });

  it("leaves a table cell, code and front matter as they were", () => {
    const table = b.table.create(null, [
      b.table_row.create(null, [b.table_cell.create(null, para())]),
    ]);
    expect(keepPastedBlock(code, caret(b.doc.create(null, table)), true)).toBe(
      code,
    );
    const inCode = caret(b.doc.create(null, b.code_block.create()));
    expect(keepPastedBlock(quoted, inCode, true)).toBe(quoted);
    const front = pasted(b.frontmatter.create(null, blocks.text("a: b")));
    const $line = caret(b.doc.create(null, para("text")));
    expect(keepPastedBlock(front, $line, true)).toBe(front);
  });
});
