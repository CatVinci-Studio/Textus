// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeViews, openView, type TestView } from "../editor-view-kit";
import { caretColumns } from "./table-caret";
import {
  alignColumns,
  resizeTable,
  sharedAlignment,
  tableSize,
} from "./table-edits";

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
