import { describe, expect, it } from "vitest";
import { Schema, Slice, type Node } from "@milkdown/kit/prose/model";
import { tableNodes } from "@milkdown/kit/prose/tables";
import { joinLinesForTableCell } from "./paste-slice";

const cells = tableNodes({
  tableGroup: "block",
  cellContent: "paragraph",
  cellAttributes: {},
});
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
    md_span: { group: "inline", inline: true, content: "inline*" },
    table: cells.table,
    table_row: cells.table_row,
    table_cell: cells.table_cell,
    table_header: cells.table_header,
  },
});
const n = schema.nodes;
const p = (...content: (Node | string)[]) =>
  n.paragraph.create(
    null,
    content.map((c) => (typeof c === "string" ? schema.text(c) : c)),
  );
const bold = (text: string) => n.md_span.create(null, schema.text(text));
const row = (...texts: (Node | string)[]) =>
  n.table_row.create(
    null,
    texts.map((t) => n.table_cell.create(null, p(t))),
  );

/** Where a paste lands: inside the text of `doc`'s first textblock. */
function landing(doc: Node) {
  let at = 0;
  doc.descendants((node, pos) => {
    if (!at && node.isTextblock) at = pos + 1;
    return !at;
  });
  return doc.resolve(at);
}

const inCell = landing(n.doc.create(null, [n.table.create(null, [row("c")])]));

describe("joinLinesForTableCell", () => {
  it("joins lines pasted into a cell into its one paragraph", () => {
    // As ProseMirror fits two pasted paragraphs to a cell.
    const slice = new Slice(row("l1", bold("l2")).content, 0, 0);
    const joined = joinLinesForTableCell(slice, inCell);
    expect(joined.content.childCount).toBe(1);
    expect(joined.content.firstChild!.textContent).toBe("l1 l2");
    expect(joined.content.firstChild!.lastChild!.type.name).toBe("md_span");
  });

  it("pastes a copied table into a cell as it is", () => {
    const table = n.table.create(null, [row("x")]);
    const slice = new Slice(n.doc.create(null, [table, p("y")]).content, 0, 1);
    expect(joinLinesForTableCell(slice, inCell)).toBe(slice);
  });

  it("leaves one line, and pastes outside a table, alone", () => {
    const one = Slice.maxOpen(n.doc.create(null, [p("a")]).content);
    expect(joinLinesForTableCell(one, inCell)).toBe(one);
    const two = Slice.maxOpen(n.doc.create(null, [p("a"), p("b")]).content);
    const outside = landing(n.doc.create(null, [p("x")]));
    expect(joinLinesForTableCell(two, outside)).toBe(two);
  });
});
