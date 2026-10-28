import { describe, expect, it } from "vitest";
import { Schema, Slice, type Node } from "@milkdown/kit/prose/model";
import { tableNodes } from "@milkdown/kit/prose/tables";
import { fillTable, joinLinesForTableCell } from "./paste-slice";

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

describe("fillTable", () => {
  // The app's tables: a header row of their own, then body rows.
  const gfm = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "text*" },
      text: {},
      table: { ...cells.table, content: "table_header_row table_row+" },
      table_header_row: { ...cells.table_row, content: "table_header*" },
      table_row: { ...cells.table_row, content: "table_cell*" },
      table_header: cells.table_header,
      table_cell: cells.table_cell,
    },
  });
  const g = gfm.nodes;
  const para = (text: string) =>
    g.paragraph.create(null, text ? gfm.text(text) : null);
  const table = (...rows: string[][]) =>
    g.table.create(
      null,
      rows.map((texts, r) =>
        (r === 0 ? g.table_header_row : g.table_row).create(
          null,
          texts.map((t) =>
            (r === 0 ? g.table_header : g.table_cell).create(null, para(t)),
          ),
        ),
      ),
    );
  const texts = (t: Node) => {
    const out: string[][] = [];
    t.forEach((row) => {
      const line: string[] = [];
      row.forEach((cell) => line.push(cell.textContent));
      out.push(line);
    });
    return out;
  };

  it("writes the pasted cells in from the caret's cell, adding rows", () => {
    const filled = fillTable(
      table(["a", "b"], ["c", "d"]),
      1,
      0,
      table(["p", "q"], ["r", "s"]),
    );
    expect(texts(filled)).toEqual([
      ["a", "b"],
      ["p", "q"],
      ["r", "s"],
    ]);
    expect(() => filled.check()).not.toThrow();
  });

  it("adds columns, the header's too, where the paste runs past the edge", () => {
    const filled = fillTable(
      table(["a", "b"], ["c", "d"]),
      1,
      1,
      table(["p", "q", "r"], ["s", "t", "u"]),
    );
    expect(texts(filled)).toEqual([
      ["a", "b", "", ""],
      ["c", "p", "q", "r"],
      ["", "s", "t", "u"],
    ]);
    expect(() => filled.check()).not.toThrow();
  });

  it("keeps header cells in the header row", () => {
    const filled = fillTable(
      table(["a", "b"], ["c", "d"]),
      0,
      0,
      table(["p", "q"]),
    );
    expect(filled.firstChild!.firstChild!.type).toBe(g.table_header);
    expect(texts(filled)[0]).toEqual(["p", "q"]);
  });
});
