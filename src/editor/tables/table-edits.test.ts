// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeViews, openView, type TestView } from "../editor-view-kit";
import { caretColumns, TABLE_CARET_SPEC } from "./table-caret";
import type { DecorationSet } from "@milkdown/kit/prose/view";
import {
  alignColumns,
  resizeTable,
  sharedAlignment,
  tableSize,
} from "./table-edits";
import { runTableAction } from "../editor-menu-tables";

afterEach(closeViews);

const SOURCE = "| a | b |\n| :-: | --- |\n| 1 | 2 |\n\nend";

function tableAt(t: TestView) {
  let pos = -1;
  t.view.state.doc.descendants((node, at) => {
    if (pos < 0 && node.type.spec.tableRole === "table") pos = at;
    return pos < 0;
  });
  return { pos, node: t.view.state.doc.nodeAt(pos)! };
}

const lines = (t: TestView) =>
  t
    .markdown()
    .split("\n\nend")[0]
    .split("\n")
    .map((l) => l.replace(/ +/g, " "));

describe("the table's own tools", () => {
  it("knows the columns the caret is in, and their shared alignment", async () => {
    const t = await openView(SOURCE);
    t.caretAt("a");
    const at = caretColumns(t.view.state)!;
    expect(at.cols).toEqual([0]);
    expect(sharedAlignment(tableAt(t).node, at.cols)).toBe("center");
    t.caretAt("2");
    expect(caretColumns(t.view.state)!.cols).toEqual([1]);
    t.caretAt("end");
    expect(caretColumns(t.view.state)).toBeNull();
  });

  it("keeps the caret's mark on the table while it stays: a fresh one would put the caret back under a finger's tap", async () => {
    const t = await openView(SOURCE);
    const mark = () =>
      t.view.state.plugins
        .map((p) => p.props.decorations?.call(p, t.view.state))
        .find((set) =>
          (set as DecorationSet | undefined)
            ?.find()
            .some((d) => TABLE_CARET_SPEC in (d.spec as object)),
        );
    t.caretAt("2");
    const before = mark();
    expect(before).toBeDefined();
    t.view.dispatch(t.view.state.tr.setMeta("held", true));
    expect(mark()).toBe(before);
  });

  it("aligns a whole column, head row and body, as GFM writes it", async () => {
    const t = await openView(SOURCE);
    const { pos } = tableAt(t);
    t.view.dispatch(alignColumns(t.view.state.tr, pos, [1], "right"));
    expect(lines(t)[1]).toMatch(/^\| :-+: \| -+: \|$/);
    expect(sharedAlignment(tableAt(t).node, [1])).toBe("right");
  });

  it("grows at its end, new rows aligned as their columns, new columns plain", async () => {
    const t = await openView(SOURCE);
    const { pos } = tableAt(t);
    t.view.dispatch(resizeTable(t.view.state.tr, pos, 4, 3));
    expect(tableSize(tableAt(t).node)).toEqual({ rows: 4, cols: 3 });
    const out = lines(t);
    expect(out[1]).toMatch(/^\| :-+: \| -+ \| -+ \|$/);
    expect(tableAt(t).node.child(3).child(0).attrs.alignment).toBe("center");
  });

  it("is cut from its end, never below its head row and one more, or one column", async () => {
    const t = await openView(
      "| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n\nend",
    );
    const { pos } = tableAt(t);
    t.view.dispatch(resizeTable(t.view.state.tr, pos, 2, 2));
    expect(lines(t)).toEqual(["| a | b |", "| - | - |", "| 1 | 2 |"]);
    t.view.dispatch(resizeTable(t.view.state.tr, pos, 1, 0));
    expect(tableSize(tableAt(t).node)).toEqual({ rows: 2, cols: 1 });
  });
});

describe("the table's keys and pastes", () => {
  const ROWS = "| h | k |\n| - | - |\n| 1 | x |\n| 2 | y |\n\nend";
  const body = (t: TestView) => lines(t).slice(2);

  it("Alt+arrows move the caret's row and column, never above the head row", async () => {
    const t = await openView(ROWS);
    t.caretAt("2");
    t.press("Alt+ArrowUp");
    expect(body(t)).toEqual(["| 2 | y |", "| 1 | x |"]);
    t.press("Alt+ArrowUp");
    expect(lines(t)[0]).toBe("| h | k |");
    t.press("Alt+ArrowRight");
    expect(lines(t)[0]).toBe("| k | h |");
  });

  it("Backspace on a picked row takes it out", async () => {
    const t = await openView(ROWS);
    const { CellSelection } = await import("@milkdown/kit/prose/tables");
    const cell = (text: string) => {
      const $at = t.view.state.doc.resolve(t.caretAt(text));
      return $at.before($at.depth - 1);
    };
    t.view.dispatch(
      t.view.state.tr.setSelection(
        CellSelection.create(t.view.state.doc, cell("1"), cell("x")),
      ),
    );
    t.press("Backspace");
    expect(body(t)).toEqual(["| 2 | y |"]);
  });

  it("a copied row pastes in as a new row under the caret's", async () => {
    const t = await openView(ROWS);
    const { CellSelection } = await import("@milkdown/kit/prose/tables");
    const cell = (text: string) => {
      const $at = t.view.state.doc.resolve(t.caretAt(text));
      return $at.before($at.depth - 1);
    };
    t.view.dispatch(
      t.view.state.tr.setSelection(
        CellSelection.create(t.view.state.doc, cell("2"), cell("y")),
      ),
    );
    const { dom, text } = t.view.serializeForClipboard(
      t.view.state.selection.content(),
    );
    t.caretAt("1");
    t.paste(text, dom.innerHTML);
    expect(body(t)).toEqual(["| 1 | x |", "| 2 | y |", "| 2 | y |"]);
  });

  it("a copied row pastes into a table of its head row alone, as its row", async () => {
    const t = await openView(`${ROWS}\n\n| a | b |\n| - | - |\n\nend`);
    const { CellSelection } = await import("@milkdown/kit/prose/tables");
    const cell = (text: string) => {
      const $at = t.view.state.doc.resolve(t.caretAt(text));
      return $at.before($at.depth - 1);
    };
    t.view.dispatch(
      t.view.state.tr.setSelection(
        CellSelection.create(t.view.state.doc, cell("2"), cell("y")),
      ),
    );
    const { dom, text } = t.view.serializeForClipboard(
      t.view.state.selection.content(),
    );
    t.caretAt("a");
    t.paste(text, dom.innerHTML);
    const tables: number[] = [];
    t.view.state.doc.forEach((n) => {
      if (n.type.name === "table") tables.push(n.childCount);
    });
    expect(tables).toEqual([3, 2]);
  });

  it("a copied column pastes in as a new column after the caret's", async () => {
    const t = await openView(ROWS);
    const { CellSelection } = await import("@milkdown/kit/prose/tables");
    const cell = (text: string) => {
      const $at = t.view.state.doc.resolve(t.caretAt(text));
      return $at.before($at.depth - 1);
    };
    t.view.dispatch(
      t.view.state.tr.setSelection(
        CellSelection.create(t.view.state.doc, cell("k"), cell("y")),
      ),
    );
    const { dom, text } = t.view.serializeForClipboard(
      t.view.state.selection.content(),
    );
    t.caretAt("1");
    t.paste(text, dom.innerHTML);
    expect(lines(t)[0]).toBe("| h | k | k |");
    expect(body(t)).toEqual(["| 1 | x | x |", "| 2 | y | y |"]);
  });

  it("deletes the one row under its head, leaving the head alone, as Markdown allows", async () => {
    const t = await openView("| a | b |\n| --- | --- |\n| 1 | 2 |\n\nend");
    t.caretAt("1");
    runTableAction((fn) => t.editor.action(fn), "delete-row");
    expect(t.markdown()).toBe("| a | b |\n| - | - |\n\nend");
  });
});
