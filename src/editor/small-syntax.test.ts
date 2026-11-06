// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { Selection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../document-view/editor-test-harness";
import { splitAltSize } from "./images/image-html";
import { loadKatex } from "./math/katex-loader";

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

describe("Obsidian image sizes", () => {
  it.each([
    ["cat|300", { alt: "cat", width: "300" }],
    ["cat|300x200", { alt: "cat", width: "300" }],
    ["a|b", { alt: "a|b", width: "" }],
  ])("splits %j", (alt, expected) => {
    expect(splitAltSize(alt)).toEqual(expected);
  });

  it("draws ![alt|300](url) 300 px wide and saves it as written", async () => {
    const view = await open("![cat|300](cat.png)");
    const box = view.dom.querySelector<HTMLElement>(".image-view")!;
    expect(box.style.width).toBe("300px");
    expect(box.querySelector("img")?.alt).toBe("cat");
    expect(saved(view)).toBe("![cat|300](cat.png)\n\nend\n");
  });
});

describe("GitHub's math", () => {
  it("draws $`x`$ without its backticks", async () => {
    await loadKatex();
    const view = await open("Energy $`E=mc^2`$ here");
    const drawn = view.dom.querySelector(".math-inline-rendered")!;
    expect(drawn.querySelector(".katex")).not.toBeNull();
    expect(drawn.textContent).not.toContain("`");
    expect(saved(view)).toBe("Energy $`E=mc^2`$ here\n\nend\n");
  });

  it("draws a ```math fence as a display formula", async () => {
    await loadKatex();
    const markdown = "```math\n\\frac{a}{b}\n```";
    const view = await open(markdown);
    expect(view.dom.querySelector(".math-fence-hidden")).not.toBeNull();
    expect(
      view.dom.querySelector(".math-block-rendered .katex-display"),
    ).not.toBeNull();
    expect(saved(view)).toBe(`${markdown}\n\nend\n`);
  });
});
