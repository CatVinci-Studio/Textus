// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { closeViews, openView } from "../editor-view-kit";
import { parseLink } from "../markdown/link-syntax";

// Brackets, quotes and Markdown links typed by hand: what closes itself,
// what the caret steps over, and what is saved.

afterEach(closeViews);

/** The text links show. */
function linked(doc: import("@milkdown/kit/prose/model").Node): string {
  let text = "";
  doc.descendants((node) => {
    const parts = node.type.name === "link" && parseLink(node.textContent);
    if (parts) text += node.textContent.slice(...parts.label);
  });
  return text;
}

const open = (markdown = "", settings = {}) =>
  openView(markdown, { enableCompletion: false, ...settings });

// The ")" is already there: the address typed, the caret moves on without
// typing it - by Enter, or to anywhere else on the line.
for (const leave of ["Enter", "start of the line", "end of the line"])
  it(`[text](url with its ")" put in becomes a link on leaving it: ${leave}`, async () => {
    const t = await open();
    t.type("See [Textus](https://textus.md");
    expect(linked(t.view.state.doc)).toBe("");
    if (leave === "Enter") t.press("Enter");
    else if (leave === "start of the line") t.caretAt("See");
    else t.select(t.view.state.doc.firstChild!.nodeSize - 1);
    expect(linked(t.view.state.doc)).toBe("Textus");
    expect(t.markdown()).toBe("See [Textus](https://textus.md)");
  });
