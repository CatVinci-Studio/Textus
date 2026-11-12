// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { cmFind, sourceFind } from "./cm-find";

function source(doc: string) {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [history(), sourceFind] }),
    parent: document.body,
  });
  return { view, find: cmFind(() => view) };
}

const search = (query: string, useRegex = false) =>
  ({ type: "search", query, caseSensitive: false, useRegex }) as const;

describe("find in the source", () => {
  it("finds from the caret on, highlights, and follows edits", () => {
    const { view, find } = source("cat dog cat\n# Cat");
    view.dispatch({ selection: { anchor: 5 } });
    const found = find.apply(search("cat"));
    expect(found.matches.map((m) => m.from)).toEqual([0, 8, 14]);
    expect(found.activeIndex).toBe(1);
    expect(view.dom.querySelectorAll(".find-match").length).toBe(3);
    view.dispatch({ changes: { from: 0, to: 3, insert: "" } });
    expect(find.state().matches.length).toBe(2);
    view.destroy();
  });

  it("replaces all as one undo step, regex captures written out", () => {
    const { view, find } = source("a1 b2 c3");
    const found = find.apply(search("([a-z])(\\d)", true));
    find.replace(
      found.matches.map((m) => ({
        ...m,
        text: `${m.groups[2]}${m.groups[1]}`,
      })),
    );
    expect(view.state.doc.toString()).toBe("1a 2b 3c");
    undo(view);
    expect(view.state.doc.toString()).toBe("a1 b2 c3");
    view.destroy();
  });

  it("closing clears the highlights and selects the match", () => {
    const { view, find } = source("one two");
    const found = find.apply(search("two"));
    find.clear(found.matches[0]!, false);
    expect(find.state().matches).toEqual([]);
    expect(view.dom.querySelectorAll(".find-match").length).toBe(0);
    expect(view.state.selection.main).toMatchObject({ from: 4, to: 7 });
    view.destroy();
  });

  it("says when a regex doesn't compile", () => {
    const { view, find } = source("x");
    expect(find.apply(search("(", true)).error).toBe(true);
    view.destroy();
  });
});
