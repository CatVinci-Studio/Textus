// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceEditor } from "./SourceEditor";
import { sourceViewAt } from "./source-view-registry";

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

  it("reports edits and takes a new value from outside", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <SourceEditor value={markdown} onChange={onChange} typewriter={false} />,
    );
    const source = sourceViewAt(container);
    expect(source).not.toBeNull();
    source!.view.dispatch({ changes: { from: 0, insert: "X" } });
    expect(onChange).toHaveBeenCalledWith(`X${markdown}`);
    rerender(
      <SourceEditor value="# New" onChange={onChange} typewriter={false} />,
    );
    expect(sourceViewAt(container)!.view.state.doc.toString()).toBe("# New");
  });

  it("keeps the text selectable but not editable in a read-only tab", () => {
    const { container } = render(
      <SourceEditor
        value={markdown}
        onChange={vi.fn()}
        typewriter={false}
        readOnly
      />,
    );
    expect(container.querySelector(".cm-content")).toHaveAttribute(
      "contenteditable",
      "false",
    );
  });
});
