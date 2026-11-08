// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { TextSelection } from "@milkdown/kit/prose/state";
import { closeViews, openView } from "../../document-view/editor-view-kit";
import { encodeDestSpaces, encodedRuns } from "./link-syntax";

// A link's file keeps `%20`; on screen its destination reads as spaces, and
// a typed space is saved as `%20`.

beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(closeViews);

const open = (markdown: string) =>
  openView(markdown, { enableCompletion: false });

/** The first link as it reads on screen, hidden source left out. */
function shown(root: HTMLElement): string {
  const link = root.querySelector('[data-type="link"]')!.cloneNode(true);
  (link as Element)
    .querySelectorAll(".link-source-hidden")
    .forEach((el) => el.remove());
  return link.textContent ?? "";
}

describe("percent-escapes in a link", () => {
  it("read as what they stand for, where the destination shows", () => {
    expect(encodedRuns("a%20b%E4%B8%AD%zz%29")).toEqual([
      { from: 1, to: 4, text: " " },
      { from: 5, to: 14, text: "中" },
    ]);
  });

  it("show as spaces in a revealed link, the file unchanged", async () => {
    const md = "See [Nov 8](Life/Nov%208.md) here.";
    const t = await open(md);
    t.caretAt("Nov 8");
    expect(shown(t.view.dom)).toBe("[Nov 8](Life/Nov 8.md)");
    expect(t.markdown().trim()).toBe(md);
  });

  it("are passed and deleted as one character", async () => {
    const t = await open("See [x](a%20b.md) here.");
    let start = 0;
    t.view.state.doc.descendants((node, pos) => {
      if (node.type.name === "link") start = pos + 1;
    });
    const at = (offset: number) =>
      t.view.dispatch(
        t.view.state.tr.setSelection(
          TextSelection.create(t.view.state.doc, start + offset),
        ),
      );
    at("[x](a".length);
    t.press("ArrowRight");
    expect(t.caretLine()).toContain("a%20|b.md");
    t.press("ArrowLeft");
    expect(t.caretLine()).toContain("a|%20b.md");
    t.press("Delete");
    expect(t.markdown().trim()).toBe("See [x](ab.md) here.");
  });

  it("are written for a space typed into a destination", () => {
    expect(encodeDestSpaces("[Nov 8](Life/Nov 8.md)")).toBe(
      "[Nov 8](Life/Nov%208.md)",
    );
    expect(encodeDestSpaces('[a](b c.md "T")')).toBe('[a](b%20c.md "T")');
    expect(encodeDestSpaces("[a](b.md)")).toBe("[a](b.md)");
  });
});
