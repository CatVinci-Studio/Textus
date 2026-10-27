import { describe, expect, it } from "vitest";
import { Schema, type Node } from "@milkdown/kit/prose/model";
import {
  EditorState,
  TextSelection,
  type Command,
} from "@milkdown/kit/prose/state";
import { tableNodes } from "@milkdown/kit/prose/tables";
import {
  backspaceKeepingApart,
  deleteJoiningText,
  deleteKeepingApart,
  deleteSelectionKeepingApart,
} from "./block-join-plugin";

const cells = tableNodes({
  tableGroup: "block",
  cellContent: "paragraph",
  cellAttributes: {},
});
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    blockquote: { group: "block", content: "block+" },
    bullet_list: { group: "block", content: "list_item+" },
    list_item: { content: "paragraph block*" },
    code_block: { group: "block", content: "text*", code: true },
    frontmatter: { group: "block", content: "text*", code: true },
    hr: { group: "block" },
    text: { group: "inline" },
    table: { ...cells.table, content: "table_row+" },
    table_row: cells.table_row,
    table_cell: cells.table_cell,
    table_header: cells.table_header,
  },
});
const n = schema.nodes;

const p = (text = "") =>
  n.paragraph.create(null, text ? schema.text(text) : null);
const code = (text = "") =>
  n.code_block.create(null, text ? schema.text(text) : null);
const quote = (...blocks: Node[]) => n.blockquote.create(null, blocks);
const list = (...items: string[]) =>
  n.bullet_list.create(
    null,
    items.map((t) => n.list_item.create(null, p(t))),
  );
const table = (...rows: string[][]) =>
  n.table.create(
    null,
    rows.map((r) =>
      n.table_row.create(
        null,
        r.map((t) => n.table_cell.create(null, p(t))),
      ),
    ),
  );

/** The caret at the start or end of the first textblock reading `text`. */
function at(doc: Node, text: string, end: boolean): EditorState {
  let pos = -1;
  doc.descendants((node, offset) => {
    if (pos >= 0 || !node.isTextblock) return pos < 0;
    if (node.textContent === text)
      pos = offset + 1 + (end ? node.content.size : 0);
    return false;
  });
  const state = EditorState.create({ schema, doc });
  return state.apply(state.tr.setSelection(TextSelection.create(doc, pos)));
}

function run(command: Command, state: EditorState): EditorState | null {
  let next: EditorState | null = null;
  const handled = command(state, (tr) => (next = state.apply(tr)));
  return handled ? next : null;
}

const docOf = (...blocks: Node[]) => n.doc.create(null, blocks);
const caretLine = (state: EditorState) =>
  state.selection.$from.parent.textContent;
const atEnd = (state: EditorState) =>
  state.selection.$from.parentOffset ===
  state.selection.$from.parent.content.size;

describe("backspaceKeepingApart", () => {
  it("moves the caret up from a code block instead of pouring it into the paragraph", () => {
    const doc = docOf(p("text"), code("line1\nline2"));
    const next = run(backspaceKeepingApart, at(doc, "line1\nline2", false))!;
    expect(next.doc.eq(doc)).toBe(true);
    expect(caretLine(next)).toBe("text");
    expect(atEnd(next)).toBe(true);
  });

  it("keeps a paragraph out of the front matter above it", () => {
    const fm = n.frontmatter.create(null, schema.text("title: a"));
    const doc = docOf(fm, p("text"));
    const next = run(backspaceKeepingApart, at(doc, "text", false))!;
    expect(next.doc.eq(doc)).toBe(true);
    expect(caretLine(next)).toBe("title: a");
  });

  it("removes an empty line above a code block", () => {
    const doc = docOf(p("text"), p(), code("x"));
    const next = run(backspaceKeepingApart, at(doc, "x", false))!;
    expect(next.doc.eq(docOf(p("text"), code("x")))).toBe(true);
  });

  it("goes into a table's last cell from the line below it", () => {
    const doc = docOf(table(["a", "b"]), p("text"));
    const next = run(backspaceKeepingApart, at(doc, "text", false))!;
    expect(next.doc.eq(doc)).toBe(true);
    expect(caretLine(next)).toBe("b");
  });

  it("leaves an empty code block and ordinary lines to the default", () => {
    expect(
      run(backspaceKeepingApart, at(docOf(p("a"), code()), "", false)),
    ).toBeNull();
    expect(
      run(backspaceKeepingApart, at(docOf(p("a"), p("b")), "b", false)),
    ).toBeNull();
    expect(
      run(
        backspaceKeepingApart,
        at(docOf(code("a"), n.hr.create(), p("b")), "b", false),
      ),
    ).toBeNull();
  });
});

describe("backspaceKeepingApart on an empty line", () => {
  it("removes the empty line itself between two code blocks", () => {
    const doc = docOf(code("a"), p(), code("b"));
    const next = run(backspaceKeepingApart, at(doc, "", false))!;
    expect(next.doc.eq(docOf(code("a"), code("b")))).toBe(true);
    expect(caretLine(next)).toBe("a");
  });
});

describe("backspaceKeepingApart below an empty code block", () => {
  it("removes the empty code block, as Delete does", () => {
    const doc = docOf(p("a"), code(), p("b"));
    const next = run(backspaceKeepingApart, at(doc, "b", false))!;
    expect(next.doc.eq(docOf(p("a"), p("b")))).toBe(true);
  });
});

describe("deleteSelectionKeepingApart", () => {
  function selecting(doc: Node, from: string, to: string): EditorState {
    const state = at(doc, from, false);
    const end = at(doc, to, true).selection.from;
    return state.apply(
      state.tr.setSelection(
        TextSelection.create(doc, state.selection.from, end),
      ),
    );
  }

  it("keeps the code block a selection ends in", () => {
    const doc = docOf(p("text"), code("l1\nl2"));
    const next = run(
      deleteSelectionKeepingApart,
      selecting(doc, "text", "l1\nl2"),
    )!;
    expect(next.doc.eq(docOf(p(), code()))).toBe(true);
  });

  it("removes the lines wholly inside the selection", () => {
    const doc = docOf(p("a"), p("b"), code("c"));
    const next = run(deleteSelectionKeepingApart, selecting(doc, "a", "c"))!;
    expect(next.doc.eq(docOf(p(), code()))).toBe(true);
  });

  it("leaves a selection across ordinary lines to the default", () => {
    const doc = docOf(p("a"), p("b"));
    expect(
      run(deleteSelectionKeepingApart, selecting(doc, "a", "b")),
    ).toBeNull();
  });
});

describe("deleteKeepingApart", () => {
  it("moves the caret down into a code block instead of joining it", () => {
    const doc = docOf(p("text"), code("line1\nline2"));
    const next = run(deleteKeepingApart, at(doc, "text", true))!;
    expect(next.doc.eq(doc)).toBe(true);
    expect(caretLine(next)).toBe("line1\nline2");
  });

  it("goes into a table's first cell rather than selecting the table", () => {
    const doc = docOf(p("text"), table(["a", "b"]));
    const next = run(deleteKeepingApart, at(doc, "text", true))!;
    expect(next.doc.eq(doc)).toBe(true);
    expect(caretLine(next)).toBe("a");
  });

  it("removes an empty line on either side", () => {
    const below = run(
      deleteKeepingApart,
      at(docOf(code("x"), p()), "x", true),
    )!;
    expect(below.doc.eq(docOf(code("x")))).toBe(true);
    const above = run(
      deleteKeepingApart,
      at(docOf(p("a"), p(), code("x")), "", true),
    )!;
    expect(above.doc.eq(docOf(p("a"), code("x")))).toBe(true);
    expect(caretLine(above)).toBe("x");
  });
});

describe("deleteKeepingApart before a callout", () => {
  it("lands at the callout's text, past its hidden marker line", () => {
    const callout = quote(p("[!NOTE]"), p("body"));
    const doc = docOf(p("text"), callout);
    const next = run(deleteKeepingApart, at(doc, "text", true))!;
    expect(next.doc.eq(doc)).toBe(true);
    expect(caretLine(next)).toBe("body");
    expect(next.selection.$from.parentOffset).toBe(0);
  });
});

describe("deleteJoiningText", () => {
  it("joins a quote's first line onto the line above", () => {
    const doc = docOf(p("text"), quote(p("aaa"), p("bbb")));
    const next = run(deleteJoiningText, at(doc, "text", true))!;
    expect(next.doc.eq(docOf(p("textaaa"), quote(p("bbb"))))).toBe(true);
  });

  it("joins the line below a list onto its last item", () => {
    const doc = docOf(list("aaa"), p("text"));
    const next = run(deleteJoiningText, at(doc, "aaa", true))!;
    expect(next.doc.eq(docOf(list("aaatext")))).toBe(true);
  });

  it("removes an empty line above a quote, keeping the quote", () => {
    const doc = docOf(p("a"), p(), quote(p("bbb")));
    const next = run(deleteJoiningText, at(doc, "", true))!;
    expect(next.doc.eq(docOf(p("a"), quote(p("bbb"))))).toBe(true);
  });

  it("joins one list item's text onto the item above", () => {
    const next = run(deleteJoiningText, at(docOf(list("a", "b")), "a", true))!;
    expect(next.doc.eq(docOf(list("ab")))).toBe(true);
  });

  it("leaves an item holding a nested list to the default, which keeps a first line", () => {
    const nested = n.list_item.create(null, [p("b"), list("c")]);
    const doc = docOf(p("text"), n.bullet_list.create(null, nested));
    expect(run(deleteJoiningText, at(doc, "text", true))).toBeNull();
  });

  it("leaves lines side by side and table cells to the default", () => {
    expect(
      run(deleteJoiningText, at(docOf(p("a"), p("b")), "a", true)),
    ).toBeNull();
    expect(
      run(deleteJoiningText, at(docOf(table(["a", "b"])), "a", true)),
    ).toBeNull();
  });
});
