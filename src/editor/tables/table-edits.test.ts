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
import { runTableAction, tableLayoutItems } from "../editor-menu-tables";
import type { Strings } from "../../i18n/strings";

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
    // The right-click menu aligns every picked column, as the tools do.
    const { CellSelection } = await import("@milkdown/kit/prose/tables");
    const cell = (text: string) => {
      const $at = t.view.state.doc.resolve(t.caretAt(text));
      return $at.before($at.depth - 1);
    };
    t.view.dispatch(
      t.view.state.tr.setSelection(
        CellSelection.create(t.view.state.doc, cell("a"), cell("b")),
      ),
    );
    const items = tableLayoutItems((fn) => t.editor.action(fn), {} as Strings);
    (items[0] as { onSelect: () => void }).onSelect();
    expect(sharedAlignment(tableAt(t).node, [0, 1])).toBe("left");
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

  it("Alt+up and down move the caret's row, never above the head row; left and right stay the caret's", async () => {
    const t = await openView(ROWS);
    t.caretAt("2");
    t.press("Alt+ArrowUp");
    expect(body(t)).toEqual(["| 2 | y |", "| 1 | x |"]);
    t.press("Alt+ArrowUp");
    expect(lines(t)[0]).toBe("| h | k |");
    // A word at a time on a Mac: no column moves.
    t.press("Alt+ArrowRight");
    t.press("Alt+ArrowLeft");
    expect(lines(t)[0]).toBe("| h | k |");
  });

  it("iOS's own new line at a line's end before a table is refused, leaving prosemirror's Enter", async () => {
    const t = await openView(`line\n\n${ROWS}`);
    const input = (t.view as unknown as { input: { lastIOSEnter: number } })
      .input;
    const enter = () => {
      input.lastIOSEnter = Date.now();
      const event = new InputEvent("beforeinput", {
        inputType: "insertParagraph",
        bubbles: true,
        cancelable: true,
      });
      t.view.dom.dispatchEvent(event);
      return event.defaultPrevented;
    };
    t.caretAt("line", 4);
    expect(enter()).toBe(true);
    t.caretAt("line", 2);
    expect(enter()).toBe(false);
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

  it("a whole copied table pasted into its own cell adds rows, and Undo takes them out", async () => {
    const t = await openView(ROWS);
    const { tableCopy } = await import("../clipboard/table-clipboard");
    const { serializerCtx } = await import("@milkdown/kit/core");
    const { markdown } = tableCopy(
      t.view,
      t.view.state.doc.firstChild!,
      t.editor.ctx.get(serializerCtx),
    );
    t.caretAt("1");
    // As the phone's paste gives it: the Markdown alone.
    t.paste(markdown);
    expect(t.view.state.doc.firstChild!.childCount).toBeGreaterThan(3);
    t.press("Mod+z");
    expect(body(t)).toEqual(["| 1 | x |", "| 2 | y |"]);
  });

  it("a whole wider table pasted with its HTML fills from the caret's cell, as its Markdown does, in one Undo", async () => {
    const wide = "| a | | d |\n| - | - | - |\n| e | b | |\n\n";
    const t = await openView(wide + ROWS);
    const { tableCopy } = await import("../clipboard/table-clipboard");
    const { serializerCtx } = await import("@milkdown/kit/core");
    const { markdown, html } = tableCopy(
      t.view,
      t.view.state.doc.firstChild!,
      t.editor.ctx.get(serializerCtx),
    );
    t.caretAt("2");
    t.paste(markdown, html);
    const second = () => t.markdown().split("\n\n")[1]!.split("\n");
    expect(second().map((l) => l.replace(/ +/g, " "))).toEqual([
      "| h | k | |",
      "| - | - | - |",
      "| 1 | x | |",
      "| a | | d |",
      "| e | b | |",
    ]);
    // The caret stays in the cell the paste began at.
    expect(t.caretLine()).toBe("|a");
    t.press("Mod+z");
    expect(t.markdown()).toBe(wide + ROWS);
  });

  it("a copied row pasted as iOS gives it, its empty last cell gone from the HTML, goes in as a row", async () => {
    const t = await openView(ROWS);
    t.caretAt("1");
    t.paste(
      "c1\t",
      '<table data-pm-slice="1 1 -2 []"><tbody><tr><td>c1</td></tr></tbody></table>',
    );
    expect(body(t)).toEqual(["| 1 | x |", "| c1 | |", "| 2 | y |"]);
  });

  it("a copied row pasted as the phone gives it, its text alone, goes in as a row", async () => {
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
    const { text } = t.view.serializeForClipboard(
      t.view.state.selection.content(),
    );
    t.caretAt("1");
    t.paste(text);
    expect(body(t)).toEqual(["| 1 | x |", "| 2 | y |", "| 2 | y |"]);
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
    expect(t.markdown()).toBe("| a | b |\n| --- | --- |\n\nend");
  });
});
