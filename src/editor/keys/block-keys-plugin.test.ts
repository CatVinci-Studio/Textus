import { describe, expect, it } from "vitest";
import { Schema, type Node } from "@milkdown/kit/prose/model";
import {
  EditorState,
  TextSelection,
  type Command,
} from "@milkdown/kit/prose/state";
import { tableNodes } from "@milkdown/kit/prose/tables";
import {
  enterInTable,
  leaveBlockquote,
  leaveTextBlockOnEmptyLastLine,
  newlineInCode,
  parsePipeRow,
  pipeRowToTable,
  frontMatterFromFirstLine,
  shiftEnterWithoutBreak,
  spacesAfterCaret,
  splitInlineCode,
} from "./block-keys-plugin";

// The node names gfm/commonmark register, with just enough spec to run
// the commands against.
const cells = tableNodes({
  tableGroup: "block",
  cellContent: "paragraph",
  cellAttributes: {},
});
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 } },
    },
    blockquote: { group: "block", content: "block+" },
    bullet_list: { group: "block", content: "list_item+" },
    list_item: { content: "paragraph block*" },
    code_block: { group: "block", content: "text*", code: true },
    frontmatter: { group: "block", content: "text*", code: true },
    text: { group: "inline" },
    md_code_span: {
      group: "inline",
      inline: true,
      content: "text*",
      code: true,
    },
    table: { ...cells.table, content: "table_header_row table_row+" },
    table_header_row: { ...cells.table_row, content: "table_header*" },
    table_row: { ...cells.table_row, content: "table_cell*" },
    table_header: cells.table_header,
    table_cell: cells.table_cell,
  },
});
const n = schema.nodes;

const p = (text = "") =>
  n.paragraph.create(null, text ? schema.text(text) : null);
const code = (text: string) =>
  n.code_block.create(null, text ? schema.text(text) : null);
const quote = (...blocks: Node[]) => n.blockquote.create(null, blocks);
const table = (header: string[], ...rows: string[][]) =>
  n.table.create(null, [
    n.table_header_row.create(
      null,
      header.map((t) => n.table_header.create(null, p(t))),
    ),
    ...rows.map((r) =>
      n.table_row.create(
        null,
        r.map((t) => n.table_cell.create(null, p(t))),
      ),
    ),
  ]);

/** State with the cursor at the end of the first text block whose text is
 *  `marker` (or in the `nth` empty one when marker is ""). */
function stateAt(doc: Node, marker: string, nth = 0): EditorState {
  let found = -1;
  let seen = 0;
  doc.descendants((node, pos) => {
    if (found >= 0 || !node.isTextblock) return found < 0;
    if (node.textContent === marker && seen++ === nth)
      found = pos + 1 + node.content.size;
    return false;
  });
  if (found < 0) throw new Error(`no text block "${marker}"`);
  const state = EditorState.create({
    schema,
    doc: n.doc.create(null, doc.content),
  });
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, found)),
  );
}

function run(command: Command, state: EditorState): EditorState | null {
  let next: EditorState | null = null;
  const handled = command(state, (tr) => (next = state.apply(tr)));
  return handled ? next : null;
}

const docOf = (...blocks: Node[]) => n.doc.create(null, blocks);
const cursorText = (state: EditorState) =>
  state.selection.$from.parent.textContent;

describe("parsePipeRow", () => {
  it("reads the cells of a pipe row", () => {
    expect(parsePipeRow("|a|b|c|")).toEqual(["a", "b", "c"]);
    expect(parsePipeRow(" | name | age | ")).toEqual(["name", "age"]);
    expect(parsePipeRow("| a |  |")).toEqual(["a", ""]);
  });

  it("keeps escaped pipes inside a cell", () => {
    expect(parsePipeRow("| a \\| b | c |")).toEqual(["a \\| b", "c"]);
  });

  it("rejects lines that aren't one", () => {
    expect(parsePipeRow("a | b")).toBeNull();
    expect(parsePipeRow("|a|b")).toBeNull();
    expect(parsePipeRow("||")).toBeNull();
    expect(parsePipeRow("| |  |")).toBeNull();
    expect(parsePipeRow("|a\\|")).toBeNull();
  });
});

describe("pipeRowToTable", () => {
  it("turns the line into a header row plus one empty row, cursor below", () => {
    const next = run(pipeRowToTable, stateAt(docOf(p("|a|b|c|")), "|a|b|c|"))!;
    const t = next.doc.firstChild!;
    expect(t.type.name).toBe("table");
    expect(t.childCount).toBe(2);
    expect(t.child(0).textContent).toBe("abc");
    expect(t.child(1).childCount).toBe(3);
    expect(next.selection.$from.node(-2).type.name).toBe("table_row");
    expect(next.selection.$from.index(-2)).toBe(0);
  });

  it("works inside a quote", () => {
    const next = run(
      pipeRowToTable,
      stateAt(docOf(quote(p("|a|b|"))), "|a|b|"),
    )!;
    expect(next.doc.firstChild!.firstChild!.type.name).toBe("table");
  });

  it("leaves ordinary paragraphs alone", () => {
    expect(run(pipeRowToTable, stateAt(docOf(p("a | b")), "a | b"))).toBeNull();
  });
});

describe("enterInTable", () => {
  it("moves down a row, keeping the column", () => {
    const doc = docOf(table(["h1", "h2"], ["a", "b"], ["c", "d"]));
    const next = run(enterInTable, stateAt(doc, "b"))!;
    expect(cursorText(next)).toBe("d");
    expect(next.doc.eq(doc)).toBe(true);
  });

  it("moves from the header into the first row", () => {
    const next = run(
      enterInTable,
      stateAt(docOf(table(["h1", "h2"], ["a", "b"])), "h2"),
    )!;
    expect(cursorText(next)).toBe("b");
  });

  it("adds a row below the last one, cursor in its first cell", () => {
    const next = run(
      enterInTable,
      stateAt(docOf(table(["h1", "h2"], ["a", "b"])), "b"),
    )!;
    const t = next.doc.firstChild!;
    expect(t.childCount).toBe(3);
    expect(next.selection.$from.index(-2)).toBe(0);
    expect(next.selection.$from.index(-3)).toBe(2);
  });

  it("leaves the table from an empty last row, removing it", () => {
    const doc = docOf(table(["h"], ["a"], [""]), p("after"));
    const next = run(enterInTable, stateAt(doc, ""))!;
    expect(next.doc.firstChild!.childCount).toBe(2);
    expect(next.doc.child(1).type.name).toBe("paragraph");
    expect(cursorText(next)).toBe("");
    expect(next.selection.$from.depth).toBe(1);
    expect(next.doc.child(2).textContent).toBe("after");
  });

  it("keeps the only body row when leaving", () => {
    const next = run(enterInTable, stateAt(docOf(table(["h"], [""])), ""))!;
    expect(next.doc.firstChild!.childCount).toBe(2);
    expect(next.doc.childCount).toBe(2);
    expect(next.selection.$from.depth).toBe(1);
  });

  it("does nothing outside a table", () => {
    expect(run(enterInTable, stateAt(docOf(p("x")), "x"))).toBeNull();
  });
});

describe("leaveTextBlockOnEmptyLastLine", () => {
  it("drops the empty last line and continues below the block", () => {
    const doc = docOf(code("let x;\n"), p("after"));
    const next = run(leaveTextBlockOnEmptyLastLine, stateAt(doc, "let x;\n"))!;
    expect(next.doc.child(0).textContent).toBe("let x;");
    expect(next.doc.child(1).type.name).toBe("paragraph");
    expect(next.selection.$from.parent).toBe(next.doc.child(1));
    expect(next.doc.child(2).textContent).toBe("after");
  });

  it("reuses an empty paragraph already below", () => {
    const next = run(
      leaveTextBlockOnEmptyLastLine,
      stateAt(docOf(code("x\n"), p()), "x\n"),
    )!;
    expect(next.doc.childCount).toBe(2);
    expect(next.selection.$from.parent).toBe(next.doc.child(1));
  });

  it("keeps a last line of only indentation: Enter there carries it on", () => {
    expect(
      run(
        leaveTextBlockOnEmptyLastLine,
        stateAt(docOf(code("  if x:\n    y\n    ")), "  if x:\n    y\n    "),
      ),
    ).toBeNull();
  });

  it("keeps a last line with text after the indentation", () => {
    expect(
      run(
        leaveTextBlockOnEmptyLastLine,
        stateAt(docOf(code("a\n  b")), "a\n  b"),
      ),
    ).toBeNull();
  });

  it("needs the empty line first: one Enter on text only adds a line", () => {
    expect(
      run(
        leaveTextBlockOnEmptyLastLine,
        stateAt(docOf(code("let x;")), "let x;"),
      ),
    ).toBeNull();
    expect(
      run(leaveTextBlockOnEmptyLastLine, stateAt(docOf(code("")), "")),
    ).toBeNull();
  });
});

describe("leaveBlockquote", () => {
  it("continues below the quote from any line", () => {
    const doc = docOf(quote(p("one"), p("two")), p("after"));
    const next = run(leaveBlockquote, stateAt(doc, "one"))!;
    expect(next.doc.child(0).childCount).toBe(2);
    expect(next.doc.child(1).type.name).toBe("paragraph");
    expect(next.selection.$from.depth).toBe(1);
    expect(next.selection.$from.index(0)).toBe(1);
  });

  it("leaves the innermost quote", () => {
    const next = run(
      leaveBlockquote,
      stateAt(docOf(quote(quote(p("in")))), "in"),
    )!;
    expect(next.selection.$from.depth).toBe(2);
    expect(next.selection.$from.node(1).type.name).toBe("blockquote");
  });

  it("leaves code blocks inside the quote to their own exit", () => {
    expect(
      run(leaveBlockquote, stateAt(docOf(quote(code("x"))), "x")),
    ).toBeNull();
  });

  it("does nothing outside a quote", () => {
    expect(run(leaveBlockquote, stateAt(docOf(p("x")), "x"))).toBeNull();
  });
});

describe("shiftEnterWithoutBreak", () => {
  it("splits a heading instead of putting a line break in it", () => {
    const heading = n.heading.create({ level: 2 }, schema.text("Title"));
    const next = run(shiftEnterWithoutBreak, stateAt(docOf(heading), "Title"))!;
    expect(next.doc.childCount).toBe(2);
    expect(next.doc.child(0).textContent).toBe("Title");
    expect(next.selection.$from.parent).toBe(next.doc.child(1));
  });

  it("puts a newline in a code block", () => {
    const next = run(shiftEnterWithoutBreak, stateAt(docOf(code("ab")), "ab"))!;
    expect(next.doc.firstChild!.textContent).toBe("ab\n");
  });

  it("leaves paragraphs to the line break", () => {
    expect(run(shiftEnterWithoutBreak, stateAt(docOf(p("x")), "x"))).toBeNull();
  });
});

describe("splitInlineCode", () => {
  it("splits the line and the code span, instead of a newline in the span", () => {
    const line = n.paragraph.create(null, [
      schema.text("a "),
      n.md_code_span.create(null, schema.text("bc")),
    ]);
    const state = EditorState.create({ schema, doc: docOf(line) });
    // Between "b" and "c", inside the span.
    const inside = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 5)),
    );
    const next = run(splitInlineCode, inside)!;
    expect(next.doc.childCount).toBe(2);
    expect(next.doc.child(0).lastChild!.textContent).toBe("b");
    expect(next.doc.child(1).firstChild!.type.name).toBe("md_code_span");
    expect(next.doc.child(1).textContent).toBe("c");
  });

  it("does nothing outside an inline code node", () => {
    expect(run(splitInlineCode, stateAt(docOf(p("x")), "x"))).toBeNull();
    expect(run(splitInlineCode, stateAt(docOf(code("x")), "x"))).toBeNull();
  });
});

describe("frontMatterFromFirstLine", () => {
  it("makes --- on the first line front matter, the caret in it", () => {
    const next = run(
      frontMatterFromFirstLine,
      stateAt(docOf(p("---")), "---"),
    )!;
    expect(next.doc.firstChild!.type.name).toBe("frontmatter");
    expect(next.selection.$from.parent).toBe(next.doc.firstChild);
  });

  it("leaves --- anywhere else to Enter", () => {
    expect(
      run(frontMatterFromFirstLine, stateAt(docOf(p("x"), p("---")), "---")),
    ).toBeNull();
    expect(
      run(frontMatterFromFirstLine, stateAt(docOf(p("--- x")), "--- x")),
    ).toBeNull();
  });
});

describe("spacesAfterCaret", () => {
  /** The paragraph "one two" with the caret after "one". */
  const beforeSpace = () => {
    const state = stateAt(docOf(p("one two")), "one two");
    return state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 4)),
    );
  };

  it("takes out the spaces the new line would start with", () => {
    const state = beforeSpace();
    expect(state.apply(spacesAfterCaret(state)!).doc.textContent).toBe(
      "onetwo",
    );
  });

  it("keeps a code block's spaces", () => {
    const state = stateAt(docOf(code("a  b")), "a  b");
    const at = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 2)),
    );
    expect(spacesAfterCaret(at)).toBeNull();
  });
});

describe("newlineInCode", () => {
  it("starts the new line indented as the one above", () => {
    const next = run(
      newlineInCode,
      stateAt(docOf(code("if x:\n    y")), "if x:\n    y"),
    )!;
    expect(cursorText(next)).toBe("if x:\n    y\n    ");
  });

  it("leaves a line of only indentation empty and carries the indentation on", () => {
    const next = run(
      newlineInCode,
      stateAt(docOf(code("if x:\n    ")), "if x:\n    "),
    )!;
    expect(cursorText(next)).toBe("if x:\n\n    ");
    expect(next.selection.$from.parentOffset).toBe(cursorText(next).length);
  });

  it("is a new line in a code block in a list, not a new item", () => {
    const list = n.bullet_list.create(null, [
      n.list_item.create(null, [p("item"), code("x")]),
    ]);
    const next = run(newlineInCode, stateAt(docOf(list), "x"))!;
    expect(next.doc.child(0).childCount).toBe(1);
    expect(cursorText(next)).toBe("x\n");
  });

  it("leaves other blocks alone", () => {
    expect(run(newlineInCode, stateAt(docOf(p("text")), "text"))).toBeNull();
  });
});
