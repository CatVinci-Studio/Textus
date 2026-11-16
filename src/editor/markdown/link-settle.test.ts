// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { EditorView } from "@milkdown/kit/prose/view";
import { undo } from "@milkdown/kit/prose/history";
import { closeViews, openView } from "../editor-view-kit";
import { pickedText } from "../completion/completion-plugin";

// Typed text that reads as a link becomes one once the caret is past it,
// as GFM would read the file on reopening; the Markdown stays as typed.

afterEach(closeViews);

const links = (view: EditorView) => {
  const found: string[] = [];
  view.state.doc.descendants((node) => {
    if (node.type.name === "link") found.push(node.textContent);
  });
  return found;
};

const typed = async (text: string) => {
  const t = await openView("", { enableCompletion: false });
  t.type(text);
  return t;
};

describe("a link typed out", () => {
  it("keeps the text typed against it in the URL, as GFM reads it", async () => {
    const t = await typed("see https://x.org中文 then");
    expect(links(t.view)).toEqual(["https://x.org中文"]);
  });

  it("is undone apart from the URL typed before it", async () => {
    const t = await typed("see https://x.org ");
    undo(t.view.state, t.view.dispatch);
    expect(links(t.view)).toEqual([]);
    expect(t.view.state.doc.textContent).toBe("see https://x.org ");
  });
});

describe("a link picked from the [[ list", () => {
  it("goes in one undo step, back to what was typed", async () => {
    const t = await typed("see [[Ov");
    const to = t.view.state.selection.to;
    t.view.dispatch(
      pickedText(t.view.state, "[Over story](Over%20story.md)", to - 4, to),
    );
    expect(links(t.view)).toEqual(["[Over story](Over%20story.md)"]);
    undo(t.view.state, t.view.dispatch);
    expect(t.markdown()).toMatch(/^see \\?\[\\?\[Ov/);
    expect(links(t.view)).toEqual([]);
  });
});
