// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeViews, openView } from "../../document-view/editor-view-kit";
import { convertList, toggleList } from "./block-toggles";

beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(closeViews);

describe("Format › a list kind", () => {
  it("turns the whole list the caret is in, every item", async () => {
    const t = await openView("- one\n- two\n", { enableCompletion: false });
    t.caretAt("one");
    expect(convertList(t.view, "ordered_list")).toBe(true);
    expect(t.markdown()).toBe("1. one\n2. two");
    expect(convertList(t.view, "ordered_list")).toBe(false);
  });

  it("makes a paragraph a list", async () => {
    const t = await openView("alone", { enableCompletion: false });
    t.caretAt("alone");
    toggleList(t.view, "bullet_list");
    expect(t.markdown()).toMatch(/^[-*] alone$/);
  });
});
