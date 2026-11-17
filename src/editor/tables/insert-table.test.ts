// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeViews, openView } from "../editor-view-kit";
import { insertTable } from "./insert-table";
import { DOMParser, DOMSerializer } from "@milkdown/kit/prose/model";

afterEach(async () => {
  vi.useRealTimers();
  await closeViews();
});

describe("a new table", () => {
  it("is saved with no column alignment", async () => {
    const t = await openView("above\n");
    t.caretAtEnd();
    insertTable((fn) => t.editor.action(fn), 2, 2);
    expect(t.markdown()).toMatch(/\| -+ \| -+ \|/);
    expect(t.markdown()).not.toContain(":-");
    // Copied and pasted inside the editor, still none.
    const { schema, doc } = t.view.state;
    const box = document.createElement("div");
    box.append(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));
    const back = DOMParser.fromSchema(schema).parse(box);
    back.descendants((node) => {
      if (
        node.type.spec.tableRole?.includes("cell") ||
        node.type.spec.tableRole === "header_cell"
      )
        expect(node.attrs.alignment).toBeNull();
    });
  });

  it("keeps its caret in the first cell when the browser puts back the one it had", async () => {
    vi.useFakeTimers();
    const t = await openView("above\n");
    t.caretAtEnd();
    insertTable((fn) => t.editor.action(fn), 2, 2);
    const cell = t.view.state.selection.from;
    const $cell = t.view.state.selection.$from;
    expect($cell.node($cell.depth - 1).type.spec.tableRole).toMatch(/cell/);
    // WebKit's old caret, put back as the dialog lets go.
    t.caretAt("above", 2);
    vi.advanceTimersByTime(500);
    expect(t.view.state.selection.from).toBe(cell);
  });

  it("leaves the caret where the writer took it at once, the next cell or the line above", async () => {
    vi.useFakeTimers();
    const t = await openView("above\n");
    t.caretAtEnd();
    insertTable((fn) => t.editor.action(fn), 2, 2);
    // A press at once (as a key is): the caret it moves is the writer's.
    t.view.dom.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    const moved = t.caretAt("above", 2);
    vi.advanceTimersByTime(500);
    expect(t.view.state.selection.from).toBe(moved);
  });

  it("leaves the caret alone once something was typed", async () => {
    vi.useFakeTimers();
    const t = await openView("above\n");
    t.caretAtEnd();
    insertTable((fn) => t.editor.action(fn), 2, 2);
    t.type("x");
    const typed = t.caretAt("above", 2);
    vi.advanceTimersByTime(500);
    expect(t.view.state.selection.from).toBe(typed);
  });
});
