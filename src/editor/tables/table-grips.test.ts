// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { EditorView } from "@milkdown/kit/prose/view";
import { attachGrips } from "./table-grips";

function setUp() {
  const wrapper = document.createElement("div");
  wrapper.innerHTML =
    "<table><tbody><tr><th>a</th><th>b</th></tr><tr><td>c</td><td>d</td></tr></tbody></table>";
  document.body.append(wrapper);
  const table = wrapper.querySelector("table")!;
  const tbody = wrapper.querySelector("tbody")!;
  const grips = attachGrips({
    wrapper,
    table,
    tbody,
    view: {} as EditorView,
    getPos: () => 0,
  });
  const cells = [...wrapper.querySelectorAll<HTMLElement>("th, td")];
  const rowGrip = wrapper.querySelector<HTMLElement>(".table-grip-row")!;
  const move = (cell: HTMLElement, pointerType: string) => {
    const e = new MouseEvent("pointermove", { bubbles: true });
    Object.defineProperty(e, "pointerType", { value: pointerType });
    cell.dispatchEvent(e);
  };
  return { wrapper, grips, cells, rowGrip, move };
}

/** A layout box for `el` in jsdom, and a screen box twice that (a zoom). */
function lay(el: HTMLElement, x: number, y: number, w: number, h: number) {
  const set = (name: string, value: unknown) =>
    Object.defineProperty(el, name, { value, configurable: true });
  set("offsetLeft", x);
  set("offsetTop", y);
  set("offsetWidth", w);
  set("offsetHeight", h);
  set("getBoundingClientRect", () => new DOMRect(x * 2, y * 2, w * 2, h * 2));
}

describe("table grips", () => {
  it("sit at the middle of their row's left edge and their column's top edge, whatever the zoom and the table's scroll", () => {
    const { wrapper, grips, cells, rowGrip } = setUp();
    const table = wrapper.querySelector("table")!;
    const scroller = document.createElement("div");
    wrapper.prepend(scroller);
    scroller.append(table);
    Object.defineProperty(scroller, "scrollLeft", { value: 30 });
    lay(table, 10, 20, 400, 80);
    const row = cells[2]!.parentElement!;
    lay(row, 0, 40, 400, 40);
    lay(cells[3]!, 200, 0, 200, 40);
    for (const el of [table, row, cells[3]!])
      Object.defineProperty(el, "offsetParent", {
        value: el === table ? wrapper : el === row ? table : row,
      });
    Object.defineProperty(wrapper, "clientWidth", {
      value: 1000,
      configurable: true,
    });
    grips.follow(cells[3]!);
    const colGrip = wrapper.querySelector<HTMLElement>(".table-grip-col")!;
    expect(rowGrip.style.transform).toBe("translate(0px, 80px)");
    expect(colGrip.style.transform).toBe("translate(280px, 20px)");
    // Its column half cut by the scroller's edge: the middle of what shows.
    Object.defineProperty(wrapper, "clientWidth", { value: 300 });
    grips.follow(cells[3]!);
    expect(colGrip.style.transform).toBe("translate(240px, 20px)");
    grips.destroy();
    wrapper.remove();
  });

  it("follow the caret through a finger's touches, and a mouse over the table instead", () => {
    const { wrapper, grips, cells, rowGrip, move } = setUp();
    grips.follow(cells[2]);
    expect(rowGrip.hidden).toBe(false);
    // A finger on the head row: the grips stay with the caret's row.
    move(cells[0], "touch");
    expect(rowGrip.hidden).toBe(false);
    // A mouse there: they go with it, whatever the caret does.
    move(cells[0], "mouse");
    grips.follow(cells[3]);
    expect(rowGrip.hidden).toBe(true);
    // The mouse gone, the caret leads again.
    wrapper.dispatchEvent(new MouseEvent("pointerleave"));
    grips.follow(cells[3]);
    expect(rowGrip.hidden).toBe(false);
    grips.destroy();
    wrapper.remove();
  });
});
