// @vitest-environment jsdom

import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { afterEach, expect, it, vi } from "vitest";
import { createTestEditor } from "../editor-test-kit";
import { revealNthHeading, selectNthSection } from "./heading-jump";

let editor: Editor | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await editor?.destroy();
  editor = null;
});

it.each([
  ["going to a heading", revealNthHeading],
  ["selecting a section", selectNthSection],
])(
  "%s glides from where the page was, not from where WebKit's focus scrolled it",
  async (_, jump) => {
    editor = await createTestEditor("# One\n\ntext\n\n# Two\n\nmore");
    const view = editor.ctx.get(editorViewCtx);
    const scroller = view.dom.parentElement!;
    scroller.classList.add("editor-scroll");
    scroller.scrollTop = 100;
    // WebKit: the editor taking the focus scrolls to its caret.
    vi.spyOn(view, "focus").mockImplementation(() => {
      scroller.scrollTop = 4000;
    });
    // jsdom lays nothing out, and its tests move nothing: the heading is
    // where the scroll already is, so the page stays put.
    jump(view, 1);
    expect(scroller.scrollTop).toBe(100);
  },
);
