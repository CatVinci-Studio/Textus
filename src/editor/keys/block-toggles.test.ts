// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeViews, openView } from "../editor-view-kit";
import {
  convertList,
  cycleHeading,
  toggleBlockquote,
  toggleList,
} from "./block-toggles";

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

  it("makes a paragraph a list, the caret in its text or in a span", async () => {
    const t = await openView("alone", { enableCompletion: false });
    t.caretAt("alone");
    toggleList(t.view, "bullet_list");
    expect(t.markdown()).toMatch(/^[-*] alone$/);
    const styled = await openView("*one* two\n\n**three**", {
      enableCompletion: false,
    });
    styled.caretAt("one");
    toggleList(styled.view, "bullet_list");
    styled.caretAt("three");
    toggleBlockquote(styled.view);
    expect(styled.markdown()).toMatch(/^[-*] \*one\* two\n\n> \*\*three\*\*$/);
  });
});

describe("the phone toolbar's block buttons", () => {
  it("H steps through the heading levels and back to a paragraph", async () => {
    const t = await openView("plain words", { enableCompletion: false });
    t.caretAt("plain");
    const shown = [];
    for (let i = 0; i < 4; i++) {
      cycleHeading(t.view);
      shown.push(t.markdown());
    }
    expect(shown).toEqual([
      "# plain words",
      "## plain words",
      "### plain words",
      "plain words",
    ]);
  });

  it("a list switches kind, then comes off again", async () => {
    const t = await openView("plain words", { enableCompletion: false });
    t.caretAt("plain");
    toggleList(t.view, "bullet_list");
    expect(t.markdown()).toMatch(/^[-*] plain words$/);
    toggleList(t.view, "ordered_list");
    expect(t.markdown()).toBe("1. plain words");
    toggleList(t.view, "ordered_list");
    expect(t.markdown()).toBe("plain words");
  });

  it("a quote comes on and off", async () => {
    const t = await openView("plain words", { enableCompletion: false });
    t.caretAt("plain");
    toggleBlockquote(t.view);
    expect(t.markdown()).toBe("> plain words");
    toggleBlockquote(t.view);
    expect(t.markdown()).toBe("plain words");
  });
});

describe("Backspace in a quote", () => {
  it("at the start of an emptied quoted line takes it out of the quote", async () => {
    const t = await openView("> quoted words", { enableCompletion: false });
    t.caretAt("quoted words", 0, "quoted words".length);
    t.press("Backspace");
    t.press("Backspace");
    expect(t.view.state.doc.firstChild?.type.name).not.toBe("blockquote");
  });

  it("at the start of a later line joins it to the line above, caret between", async () => {
    const t = await openView("> 温度修正是用来处理的，\n>\n> 普通的分类器", {
      enableCompletion: false,
    });
    t.caretAt("普通的分类器");
    t.press("Backspace");
    expect(t.markdown()).toBe("> 温度修正是用来处理的，普通的分类器");
    t.type("X");
    expect(t.markdown()).toBe("> 温度修正是用来处理的，X普通的分类器");
  });
});
