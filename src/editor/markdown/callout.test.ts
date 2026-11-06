// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { Selection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { readCalloutLine } from "./callout-syntax";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

/** `markdown` opened with the caret on a last line of its own, away from
 *  every callout. */
async function open(markdown: string): Promise<EditorView> {
  const editor = await createTestEditor(`${markdown}\n\nend\n`);
  editors.push(editor);
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
  return view;
}

const saved = (view: EditorView) =>
  editors[editors.length - 1].action((ctx) =>
    ctx.get(serializerCtx)(view.state.doc),
  );

describe("readCalloutLine", () => {
  it.each([
    ["[!NOTE]", "NOTE", "note", "", ""],
    ["[!faq]- Why?", "faq", "warning", "-", "Why?"],
    ["[!Success]+", "Success", "tip", "+", ""],
    ["[!my-type] Mine", "my-type", "note", "", "Mine"],
    ["[!cite]", "cite", "quote", "", ""],
    ["[!caution]", "caution", "caution", "", ""],
  ])("reads %j", (line, name, kind, fold, title) => {
    expect(readCalloutLine(line)).toMatchObject({ name, kind, fold, title });
  });

  it("needs a space between the marker and a title", () => {
    expect(readCalloutLine("[!NOTE]text")).toBeNull();
  });
});

describe("callouts in the editor", () => {
  it("draws an Obsidian type with its title in place of the label", async () => {
    const view = await open("> [!info] Read this\n> body");
    const quote = view.dom.querySelector("blockquote")!;
    expect(quote.className).toContain("md-alert-note");
    expect(quote.dataset.callout).toBe("info");
    expect(quote.querySelector(".md-alert-title")?.textContent).toBe(
      "Read this",
    );
  });

  it("draws an unknown type as a note named after its type", async () => {
    const view = await open("> [!recipe]\n> flour");
    const quote = view.dom.querySelector("blockquote")!;
    expect(quote.className).toContain("md-alert-note");
    expect(quote.querySelector(".md-alert-title")?.textContent).toBe("Recipe");
  });

  it("folds a '-' callout and opens it from its chevron", async () => {
    const view = await open("> [!faq]- Why?\n>\n> Because.");
    const quote = () => view.dom.querySelector("blockquote")!;
    expect(quote().classList.contains("md-alert-folded")).toBe(true);
    const chevron = quote().querySelector<HTMLElement>(".md-alert-fold")!;
    chevron.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(quote().classList.contains("md-alert-folded")).toBe(false);
  });

  it("leaves a '+' callout open", async () => {
    const view = await open("> [!tip]+ Open\n>\n> body");
    const quote = view.dom.querySelector("blockquote")!;
    expect(quote.classList.contains("md-alert-folded")).toBe(false);
    expect(quote.querySelector(".md-alert-fold")).not.toBeNull();
  });

  it("draws a callout inside a callout", async () => {
    const view = await open("> [!note]\n> outer\n>\n> > [!bug] Inner\n> > x");
    const [outer, inner] = view.dom.querySelectorAll("blockquote");
    expect(outer.className).toContain("md-alert-note");
    expect(inner.className).toContain("md-alert-caution");
  });

  it.each([
    "> [!faq]- Why?\n>\n> Because.\n",
    "> [!info] Title *with* words\n> body\n",
    "> [!note]\n> outer\n>\n> > [!bug] Inner\n> > x\n",
  ])("saves %j as it was, folded or not", async (markdown) => {
    const view = await open(markdown.trimEnd());
    const chevron = view.dom.querySelector<HTMLElement>(".md-alert-fold");
    chevron?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(saved(view)).toBe(`${markdown}\nend\n`);
  });
});
