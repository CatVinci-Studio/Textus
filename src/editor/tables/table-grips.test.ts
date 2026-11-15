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

describe("table grips", () => {
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
