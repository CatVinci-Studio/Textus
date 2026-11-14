// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InsertTableDialog } from "./InsertTableDialog";
afterEach(cleanup);
function setup() {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  const result = render(
    <InsertTableDialog
      title="Insert table"
      rowsLabel="Rows"
      columnsLabel="Columns"
      confirmLabel="Insert"
      cancelLabel="Cancel"
      onInsert={onInsert}
      onClose={onClose}
    />,
  );
  return { ...result, onInsert, onClose };
}
describe("table dialog keyboard and validation", () => {
  it.each(["0", "1.5", "51", ""])("rejects invalid rows: %s", (value) => {
    const { onInsert } = setup();
    fireEvent.change(screen.getByLabelText("Rows"), { target: { value } });
    fireEvent.keyDown(screen.getByLabelText("Rows"), { key: "Enter" });
    expect(onInsert).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Insert" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("submits valid dimensions once from an input", () => {
    const { onInsert, onClose } = setup();
    fireEvent.keyDown(screen.getByLabelText("Rows"), { key: "Enter" });
    expect(onInsert).toHaveBeenCalledExactlyOnceWith(3, 3);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("does not submit when confirming IME text or pressing Enter on Cancel", () => {
    const { onInsert } = setup();
    fireEvent.keyDown(screen.getByLabelText("Rows"), {
      key: "Enter",
      isComposing: true,
    });
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), {
      key: "Enter",
    });
    expect(onInsert).not.toHaveBeenCalled();
  });
  it("traps Tab and restores previous focus when closed", () => {
    const previous = document.createElement("button");
    document.body.append(previous);
    previous.focus();
    const { unmount } = setup();
    expect(document.activeElement).toBe(screen.getByLabelText("Rows"));
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Insert" }),
    );
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByLabelText("Rows"));
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
