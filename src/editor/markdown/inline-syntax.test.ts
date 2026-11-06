// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { Selection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { findInlineSyntax } from "./inline-syntax";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

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

/** The paragraph's text the reader sees: hidden parts left out. */
function visible(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(".md-syntax-hidden").forEach((n) => n.remove());
  return clone.textContent ?? "";
}

describe("findInlineSyntax", () => {
  it("finds comments, footnotes and a trailing block id", () => {
    expect(
      findInlineSyntax("a %%b%% c^[note] d ^id-1").map((s) => s.kind),
    ).toEqual(["comment", "footnote", "blockId"]);
  });

  it("leaves a footnote or id inside a comment to it", () => {
    expect(findInlineSyntax("%%x ^[n] ^abc%%").map((s) => s.kind)).toEqual([
      "comment",
    ]);
  });

  it("needs a space before a block id", () => {
    expect(findInlineSyntax("x^abc")).toEqual([]);
  });
});

describe("inline syntax in the editor", () => {
  it("hides a comment while the caret is away and shows it on it", async () => {
    const view = await open("before %%secret [[Note]]%% after");
    const para = () => view.dom.querySelector("p")!;
    expect(visible(para())).toBe("before  after");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 12)),
    );
    expect(para().querySelector(".md-comment")).not.toBeNull();
  });

  it("folds a paragraph that is all comment", async () => {
    const view = await open("%%only a comment%%");
    expect(view.dom.querySelector("p.md-comment-block")).not.toBeNull();
  });

  it("dims a block id", async () => {
    const view = await open("A paragraph ^abc123");
    expect(view.dom.querySelector(".md-block-id")?.textContent).toBe("^abc123");
  });

  it("draws an inline footnote with its brackets hidden", async () => {
    const view = await open("Text^[a note] more");
    const para = view.dom.querySelector("p")!;
    expect(para.querySelector(".md-inline-footnote")?.textContent).toBe(
      "a note",
    );
    expect(visible(para)).toBe("Texta note more");
  });

  it("colours a highlight that opens with a colour emoji", async () => {
    const view = await open("a ==🔴red== b");
    const mark = view.dom.querySelector("mark")!;
    expect(mark.classList.contains("md-mark-red")).toBe(true);
    expect(visible(mark)).toBe("red");
  });

  it.each([
    "before %%secret%% after\n",
    "%%only a comment%%\n",
    "A paragraph ^abc123\n",
    "Text^[a note] more\n",
    "a ==🔴red== b\n",
  ])("saves %j as it was", async (markdown) => {
    const view = await open(markdown.trimEnd());
    expect(saved(view)).toBe(`${markdown}\nend\n`);
  });

  it("keeps the escape where the footnote's brackets would read as a link", async () => {
    const view = await open("not a link ^\\[x](u)");
    expect(saved(view)).not.toContain("^[x](u)");
  });
});
