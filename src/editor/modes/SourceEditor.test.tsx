// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceEditor } from "./SourceEditor";
import { sourceViewAt } from "./source-view-registry";
import { flushEditor } from "../tab-editor";
import { editInFocus } from "../../engine/controls/edit-in-focus";
import { runScopeHandlers } from "@codemirror/view";

afterEach(cleanup);

const markdown = "# Title\n\n**bold** and [link](url)\n";

describe("SourceEditor", () => {
  it("renders Markdown tokens in several colours, not one plain text run", () => {
    const { container } = render(
      <SourceEditor value={markdown} onChange={vi.fn()} typewriter={false} />,
    );
    expect(container.querySelector(".cm-content")).toBeInTheDocument();
    const classes = new Set(
      Array.from(container.querySelectorAll(".cm-line span"), (span) =>
        span.getAttribute("class"),
      ),
    );
    expect(classes.size).toBeGreaterThan(1);
  });

  it("reports edits after a pause or a flush, and takes a new value from outside", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container, rerender } = render(
      <SourceEditor
        tabId="t"
        value={markdown}
        onChange={onChange}
        typewriter={false}
      />,
    );
    const source = sourceViewAt(container);
    expect(source).not.toBeNull();
    source!.view.dispatch({ changes: { from: 0, insert: "X" } });
    source!.view.dispatch({ changes: { from: 0, insert: "Y" } });
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(`YX${markdown}`);
    // A save pulls in what was typed a moment before.
    source!.view.dispatch({ changes: { from: 0, insert: "Z" } });
    expect(flushEditor("t")).toBe(`ZYX${markdown}`);
    expect(onChange).toHaveBeenLastCalledWith(`ZYX${markdown}`);
    expect(flushEditor("t")).toBeNull();
    vi.useRealTimers();
    rerender(
      <SourceEditor value="# New" onChange={onChange} typewriter={false} />,
    );
    expect(sourceViewAt(container)!.view.state.doc.toString()).toBe("# New");
  });

  it("in a read-only tab stays focusable, for a caret the keys move, and read-only", () => {
    const { container } = render(
      <SourceEditor
        value={markdown}
        onChange={vi.fn()}
        typewriter={false}
        readOnly
      />,
    );
    const content = container.querySelector(".cm-content")!;
    // Focusable, so a caret can be placed and moved, as in a textarea.
    expect(content).toHaveAttribute("contenteditable", "true");
    const { view } = sourceViewAt(container)!;
    expect(view.state.readOnly).toBe(true);
  });

  it("takes a new value from outside without making it an undo step, keeping the caret", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <SourceEditor
        value={"one two three"}
        onChange={onChange}
        typewriter={false}
      />,
    );
    const { view, edit } = sourceViewAt(container)!;
    view.dispatch({ selection: { anchor: 11 } });
    rerender(
      <SourceEditor
        value={"one 2 three"}
        onChange={onChange}
        typewriter={false}
      />,
    );
    expect(view.state.doc.toString()).toBe("one 2 three");
    // The caret stays by "three", moved back by the shorter middle.
    expect(view.state.selection.main.head).toBe(9);
    edit("undo");
    expect(view.state.doc.toString()).toBe("one 2 three");
  });

  it("keeps an undo made before its own earlier text comes back", () => {
    const onChange = vi.fn();
    const at = (value: string) => (
      <SourceEditor
        tabId="t"
        value={value}
        onChange={onChange}
        typewriter={false}
      />
    );
    const { container, rerender } = render(at("Before after."));
    const { view, edit } = sourceViewAt(container)!;
    view.dispatch({ changes: { from: 7, insert: "![](a.png)" } });
    flushEditor("t");
    edit("undo");
    flushEditor("t");
    expect(view.state.doc.toString()).toBe("Before after.");
    // The paste's text reaches the tab only now, then the undo's.
    rerender(at("Before ![](a.png)after."));
    expect(view.state.doc.toString()).toBe("Before after.");
    rerender(at("Before after."));
    rerender(at("Before outside."));
    expect(view.state.doc.toString()).toBe("Before outside.");
  });

  it("does the Edit menu's Undo, Redo and Select All itself", () => {
    const { container } = render(
      <SourceEditor value={"abc"} onChange={vi.fn()} typewriter={false} />,
    );
    const { view, edit } = sourceViewAt(container)!;
    view.dispatch({
      changes: { from: 3, insert: "d" },
      userEvent: "input.type",
    });
    edit("undo");
    expect(view.state.doc.toString()).toBe("abc");
    edit("redo");
    expect(view.state.doc.toString()).toBe("abcd");
    edit("select-all");
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(4);
  });

  it("takes Edit › Undo from the menu when it has the keyboard", () => {
    const { container } = render(
      <SourceEditor value={"abc"} onChange={vi.fn()} typewriter={false} />,
    );
    const { view } = sourceViewAt(container)!;
    view.dispatch({
      changes: { from: 3, insert: "d" },
      userEvent: "input.type",
    });
    view.contentDOM.focus();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    editInFocus("undo");
    expect(view.state.doc.toString()).toBe("abc");
  });

  it("indents with Tab instead of letting the keyboard leave", () => {
    const { container } = render(
      <SourceEditor value={"- a"} onChange={vi.fn()} typewriter={false} />,
    );
    const { view } = sourceViewAt(container)!;
    view.dispatch({ selection: { anchor: 0 } });
    const press = (shiftKey: boolean) =>
      runScopeHandlers(
        view,
        new KeyboardEvent("keydown", { key: "Tab", shiftKey }),
        "editor",
      );
    expect(press(false)).toBe(true);
    expect(view.state.doc.toString()).toBe("\t- a");
    press(true);
    expect(view.state.doc.toString()).toBe("- a");
  });
});
