// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeViews, openView } from "../../document-view/editor-view-kit";

afterEach(closeViews);

const tags = (root: HTMLElement, selector: string) =>
  [...root.querySelectorAll(selector)].map((el) => el.textContent);

describe("subscript and superscript", () => {
  it("open as <sub> and <sup> and save as written", async () => {
    const source = "H~2~O and x^2^, 1^st^ place, ~~struck~~.";
    const t = await openView(source);
    expect(tags(t.view.dom, "sub")).toEqual(["2"]);
    expect(tags(t.view.dom, "sup")).toEqual(["2", "st"]);
    expect(tags(t.view.dom, "del")).toEqual(["struck"]);
    expect(t.markdown()).toBe(source);
  });

  it("strikes out one tilde each side away from a word, as GitHub does", async () => {
    const source = "Was ~wrong~ and ~two words~; CO~2~ and H~2~O stay.";
    const t = await openView(source);
    expect(tags(t.view.dom, "del")).toEqual(["wrong", "two words"]);
    expect(tags(t.view.dom, "sub")).toEqual(["2", "2"]);
    expect(t.markdown()).toBe(source);
  });

  it("leaves a caret with a space before its partner as text", async () => {
    const t = await openView("2^10 and 3^4 are powers.");
    expect(t.view.dom.querySelector("sup")).toBeNull();
    expect(t.markdown()).toBe("2^10 and 3^4 are powers.");
  });

  it("leaves a footnote reference a footnote", async () => {
    const source = "Text[^1] and x^2^.\n\n[^1]: Note.";
    const t = await openView(source);
    expect(tags(t.view.dom, "sup").at(-1)).toBe("2");
    expect(t.markdown()).toBe(source);
  });

  it("reads an escaped caret inside as a caret", async () => {
    const t = await openView("a^b\\^c^");
    expect(tags(t.view.dom, "sup")).toEqual(["b^c"]);
    expect(t.markdown()).toBe("a^b\\^c^");
  });

  it("forms a superscript as its closing caret is typed", async () => {
    const t = await openView("");
    t.type("x^2^ y");
    expect(tags(t.view.dom, "sup")).toEqual(["2"]);
    expect(t.markdown()).toBe("x^2^ y");
  });

  it("forms a subscript as its closing tilde is typed", async () => {
    const t = await openView("");
    t.type("H~2~O");
    expect(tags(t.view.dom, "sub")).toEqual(["2"]);
    expect(t.markdown()).toBe("H~2~O");
  });

  it("makes no subscript of tildes typed away from a word", async () => {
    const t = await openView("");
    t.type("so ~gone~ now");
    expect(t.view.dom.querySelector("sub")).toBeNull();
  });

  it("keeps typed text with spaces between tildes or carets as text", async () => {
    const t = await openView("");
    t.type("a ~ b ~ c, 2^10 ^");
    expect(t.view.dom.querySelector("sub, sup")).toBeNull();
  });

  it("still makes a strikethrough of two tildes each side", async () => {
    const t = await openView("");
    t.type("~~gone~~");
    expect(tags(t.view.dom, "del")).toEqual(["gone"]);
    expect(t.markdown()).toBe("~~gone~~");
  });

  it("escapes a typed caret that would read back as a superscript", async () => {
    const t = await openView("");
    t.type("a^b c^d");
    // The space out, by an edit that runs no input rule.
    t.view.dispatch(t.view.state.tr.delete(4, 5));
    expect(t.view.dom.querySelector("sup")).toBeNull();
    expect(t.markdown()).toBe("a\\^bc^d");
  });
});
