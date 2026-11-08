// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { EditorView } from "@milkdown/kit/prose/view";
import { closeViews, openView } from "../../document-view/editor-view-kit";

// Typed text that reads as a link becomes one once the caret is past it,
// as GFM would read the file on reopening; the Markdown stays as typed.

beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
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
  it("is a link once the caret has gone past a bare URL", async () => {
    const t = await typed("see https://x.org then");
    expect(links(t.view)).toEqual(["https://x.org"]);
    expect(t.markdown()).toBe("see https://x.org then");
  });

  it("keeps the text typed against it in the URL, as GFM reads it", async () => {
    const t = await typed("see https://x.org中文 then");
    expect(links(t.view)).toEqual(["https://x.org中文"]);
  });

  it("is still text while the caret is in it", async () => {
    const t = await typed("see https://x.org");
    expect(links(t.view)).toEqual([]);
  });

  it("settles [text](url) written out in full", async () => {
    const t = await typed("a [b](c) d");
    expect(links(t.view)).toEqual(["[b](c)"]);
    expect(t.markdown()).toBe("a [b](c) d");
  });
});
