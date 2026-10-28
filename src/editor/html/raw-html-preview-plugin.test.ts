// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { Selection } from "@milkdown/kit/prose/state";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { commentParts } from "./raw-html-preview-plugin";

const body = (text: string) => {
  const parts = commentParts(text);
  return parts && text.slice(parts.bodyFrom, parts.bodyTo);
};

describe("an HTML comment in the text", () => {
  it("reads as its words, without the markers or the blank lines in them", () => {
    expect(body("<!-- Facts to keep. -->")).toBe("Facts to keep.");
    expect(body("<!--\nWriting instructions.\n\nMore.\n-->\n")).toBe(
      "Writing instructions.\n\nMore.",
    );
    expect(body("<!---->")).toBe("");
  });

  it("is only a whole comment, never markup around or between two", () => {
    expect(commentParts("<b>bold</b>")).toBeNull();
    expect(commentParts("<!-- a --> <b>x</b> <!-- b -->")).toBeNull();
    expect(commentParts("<!-- unclosed")).toBeNull();
  });
});

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

/** An editor on `markdown`, the caret at its end, away from the HTML. */
async function open(markdown: string) {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
  const save = () =>
    editor.action((ctx) => ctx.get(serializerCtx)(view.state.doc));
  return { view, dom: view.dom, save };
}

const FOLDED = [
  "<details>",
  "<summary>More</summary>",
  "",
  "Hidden **text**.",
  "",
  "</details>",
  "",
  "After.",
  "",
].join("\n");

describe("a <details> written around markdown", () => {
  it("shows its summary and folds the markdown below it", async () => {
    const { dom } = await open(FOLDED);
    const head = dom.querySelector<HTMLDetailsElement>(
      ".raw-html-details-head details",
    )!;
    expect(head.querySelector("summary")?.textContent).toBe("More");
    expect(head.open).toBe(false);
    const body = dom.querySelector('[class*="raw-html-details-in-"]')!;
    expect(body.textContent).toBe("Hidden text.");
    expect(body.classList).toContain("raw-html-details-folded");
    expect(dom.querySelector(".raw-html-details-end")).not.toBeNull();
  });

  it("opens and folds again from its summary, leaving the file as it was", async () => {
    const { dom, save } = await open(FOLDED);
    const summary = () =>
      dom.querySelector<HTMLElement>(".raw-html-details-head summary")!;
    const body = () =>
      dom.querySelector('[class*="raw-html-details-in-"]')!.classList;
    summary().click();
    expect(body()).not.toContain("raw-html-details-folded");
    expect(
      dom.querySelector<HTMLDetailsElement>(".raw-html-details-head details")!
        .open,
    ).toBe(true);
    summary().click();
    expect(body()).toContain("raw-html-details-folded");
    expect(save()).toBe(FOLDED);
  });
});

describe("raw HTML in the editor", () => {
  it("renders a whole <details>, a table and an SVG as widgets", async () => {
    const { dom } = await open(
      [
        "<details><summary>S</summary>Body</details>",
        "",
        '<table><tr><td colspan="2" style="color: red">c</td></tr></table>',
        "",
        '<svg width="10" height="10" onload="alert(1)"><circle r="4"/></svg>',
        "",
        "End.",
      ].join("\n"),
    );
    expect(
      dom.querySelector(".raw-html-rendered details summary")?.textContent,
    ).toBe("S");
    const td = dom.querySelector<HTMLElement>(".raw-html-rendered td")!;
    expect(td.getAttribute("colspan")).toBe("2");
    expect(td.style.color).toBe("red");
    const img = dom.querySelector<HTMLImageElement>(
      ".raw-html-rendered img.html-svg",
    )!;
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(dom.querySelector(".raw-html-rendered svg")).toBeNull();
  });

  it("draws an SVG written inside a line as one picture in that line", async () => {
    const { dom } = await open(
      'An icon <svg width="8" height="8"><circle r="4"/></svg> here.\n\nEnd.\n',
    );
    const widget = dom.querySelector(".raw-html-rendered-inline")!;
    expect(widget.querySelectorAll("img.html-svg")).toHaveLength(1);
    expect(widget.closest("p")?.textContent).toContain("An icon");
  });

  it("colours the text between a styled <span> pair, and nothing unsafe", async () => {
    const { dom } = await open(
      'A <span style="color: red; background: url(x)">red</span> word.\n\nEnd.\n',
    );
    const styled = Array.from(
      dom.querySelectorAll<HTMLElement>("[style]"),
    ).find((el) => el.textContent === "red")!;
    expect(styled.getAttribute("style")).toMatch(/^color: red;?$/);
  });

  it("draws a tag pair written inside bold or italic", async () => {
    const { dom } = await open("**<u>under</u>** and *<b>bold</b>*.\n\nEnd.\n");
    expect(dom.querySelector(".rhtml-u")?.textContent).toBe("under");
    expect(dom.querySelector(".rhtml-b")?.textContent).toBe("bold");
    expect(
      Array.from(
        dom.querySelectorAll(".raw-html-source-hidden"),
        (el) => el.textContent,
      ),
    ).toEqual(["<u>", "</u>", "<b>", "</b>"]);
  });
});
