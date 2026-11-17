// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InsertTableDialog } from "./InsertTableDialog";
import { resolveStrings } from "../../i18n/strings";
import { lostCells, shownSize } from "../../engine/controls/SizeGrid";
afterEach(cleanup);
const t = resolveStrings("en");
function setup() {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  const result = render(
    <InsertTableDialog t={t} onInsert={onInsert} onClose={onClose} />,
  );
  return { ...result, onInsert, onClose };
}
const grid = () => screen.getByRole("group", { name: t.insertTable });
describe("the new table's size grid", () => {
  it("starts at 3 × 3; the arrows change it, never below a head row and one more", () => {
    const { onInsert, onClose } = setup();
    expect(screen.getByText("3 × 3")).toBeTruthy();
    fireEvent.keyDown(grid(), { key: "ArrowDown" });
    fireEvent.keyDown(grid(), { key: "ArrowRight" });
    fireEvent.keyDown(grid(), { key: "ArrowRight" });
    expect(screen.getByText("4 × 5")).toBeTruthy();
    for (let i = 0; i < 5; i++) fireEvent.keyDown(grid(), { key: "ArrowUp" });
    fireEvent.keyDown(grid(), { key: "Enter" });
    expect(onInsert).toHaveBeenCalledExactlyOnceWith(2, 5);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("takes no size from a right press", () => {
    const { onInsert } = setup();
    Element.prototype.setPointerCapture ??= () => {};
    document.elementFromPoint ??= () => null;
    fireEvent.pointerDown(grid(), { button: 2, pointerId: 1 });
    fireEvent.pointerUp(grid(), { button: 2, pointerId: 1 });
    expect(onInsert).not.toHaveBeenCalled();
  });
  it("grows a row and a column past what is lit, within its bounds", () => {
    const most = { rows: 20, cols: 12 };
    expect(shownSize({ rows: 3, cols: 3 }, { rows: 3, cols: 3 }, most)).toEqual(
      { rows: 5, cols: 6 },
    );
    expect(shownSize({ rows: 3, cols: 3 }, { rows: 9, cols: 7 }, most)).toEqual(
      { rows: 10, cols: 8 },
    );
    expect(
      shownSize({ rows: 40, cols: 3 }, { rows: 3, cols: 3 }, most).rows,
    ).toBe(20);
  });
  it("counts the cells with text a smaller size would cut", () => {
    const filled = (r: number, c: number) => !(r === 2 && c === 2);
    const now = { rows: 3, cols: 3 };
    expect(lostCells(now, { rows: 3, cols: 2 }, filled)).toBe(2);
    expect(lostCells(now, { rows: 4, cols: 4 }, filled)).toBe(0);
  });
  it("a finger's tap picks the cell it went down on, though the grid grew under it", () => {
    vi.useFakeTimers();
    const { onInsert } = setup();
    Element.prototype.setPointerCapture = () => {};
    const cell = (r: number, c: number) =>
      grid().querySelector(`[data-cell="${r},${c}"]`);
    // Down on 5 × 5; grown, the lift is over a gap, then over 6 × 5.
    const under = vi.fn().mockReturnValueOnce(cell(4, 4)).mockReturnValue(null);
    document.elementFromPoint = under;
    const touch = {
      pointerType: "touch",
      pointerId: 1,
      clientX: 50,
      clientY: 50,
    };
    fireEvent.pointerDown(grid(), touch);
    fireEvent.pointerUp(grid(), { ...touch, clientX: 52 });
    expect(onInsert).toHaveBeenCalledExactlyOnceWith(5, 5);
    // The click the lift makes doesn't reach the page under the grid.
    const page = vi.fn();
    document.body.addEventListener("mousedown", page);
    fireEvent.mouseDown(document.body);
    expect(page).not.toHaveBeenCalled();
    document.body.removeEventListener("mousedown", page);
    vi.runAllTimers();
    vi.useRealTimers();
  });
  it("Cancel closes it with nothing inserted", () => {
    const { onInsert, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onInsert).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("traps Tab and restores previous focus when closed", () => {
    const previous = document.createElement("button");
    document.body.append(previous);
    previous.focus();
    const { unmount } = setup();
    expect(document.activeElement).toBe(grid());
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(grid());
    unmount();
    expect(document.activeElement).toBe(previous);
    previous.remove();
  });
  it("leaves the caret where the insert put it, not where it was", () => {
    const editor = document.createElement("div");
    editor.tabIndex = 0;
    // jsdom has no isContentEditable of its own.
    Object.defineProperty(editor, "isContentEditable", { value: true });
    editor.innerHTML = "<p>before</p><table><tr><td>cell</td></tr></table>";
    document.body.append(editor);
    editor.focus();
    const [before, cell] = [
      editor.querySelector("p")!.firstChild!,
      editor.querySelector("td")!.firstChild!,
    ];
    const at = (node: Node) => {
      const range = document.createRange();
      range.setStart(node, 0);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    };
    at(before);
    const { unmount } = setup();
    editor.focus();
    at(cell);
    unmount();
    expect(window.getSelection()!.anchorNode).toBe(cell);
    editor.remove();
  });
});
