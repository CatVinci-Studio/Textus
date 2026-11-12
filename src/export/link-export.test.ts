// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeViews, openView } from "../editor/editor-view-kit";
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

describe("an exported wikilink", () => {
  it("is a link to where it leads, to a heading of the page, or its text", async () => {
    const t = await openView(
      "## Part two\n\nsee [[Plan|the plan]], [[#Part two]] and [[Gone]]\n\nend",
      { enableCompletion: false },
    );
    t.caretAt("end", 1);
    const html = cloneEditorContent(
      t.view.dom,
      "document",
      undefined,
      new Map([
        ["[[Plan|the plan]]", { href: "Plan.md" }],
        ["[[Gone]]", null],
      ]),
    );
    expect(html).toContain('see <a href="Plan.md">the plan</a>, ');
    expect(html).toMatch(/<a href="#part-two">#Part two<\/a> and Gone/);
  });
});

describe("an exported %%comment%%", () => {
  it("is left out, shown or folded away", async () => {
    const t = await openView("a %%secret%% b\n\n%%whole%%\n\nc %%near%% d", {
      enableCompletion: false,
    });
    t.caretAt("near", 1);
    const html = cloneEditorContent(t.view.dom, "document");
    expect(html).not.toMatch(/secret|whole|near/);
    expect(html).toContain("a  b");
  });
});
