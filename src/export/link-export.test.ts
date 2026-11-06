// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeViews, openView } from "../document-view/editor-view-kit";
import { renderMarkdownInlineHtml } from "../editor/markdown/render-html";
import { cloneEditorContent } from "./standalone-html";

afterEach(closeViews);

describe("an exported link", () => {
  it.each([
    ["with its Markdown shown", "a **b**"],
    ["shown as its text", "end"],
  ])("is written as the link %s", async (_name, caretOn) => {
    const t = await openView("see [a **b**](https://x.org) end", {
      enableCompletion: false,
    });
    t.caretAt(caretOn, 1);
    const html = cloneEditorContent(
      t.view.dom,
      "document",
      renderMarkdownInlineHtml,
    );
    expect(html).toContain(
      'see <a href="https://x.org">a <strong>b</strong></a> end',
    );
  });
});
