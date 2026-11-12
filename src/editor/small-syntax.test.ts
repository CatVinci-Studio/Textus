// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { Selection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "./editor-test-kit";
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
    // A new size keeps the picture as it is shown: no second load.
    const img = box.querySelector("img")!;
    let loads = 0;
    const own = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
    Object.defineProperty(img, "src", {
      get: () => own.get!.call(img),
      set: (v) => (loads++, own.set!.call(img, v)),
    });
    let at = -1;
    view.state.doc.descendants((n, pos) => {
      if (n.type.name === "image") at = pos;
    });
    view.dispatch(
      view.state.tr.setNodeAttribute(at, "alt", "cat|200"),
    );
    expect(box.style.width).toBe("200px");
    expect(loads).toBe(0);
    view.dispatch(view.state.tr.setNodeAttribute(at, "src", "dog.png"));
    expect(loads).toBe(1);
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

describe("formulas in a Markdown table", () => {
  const table = "| a | b |\n| - | - |\n| $x \\| y$ | 2 |";

  it("reads \\| in a cell's formula as one bar and saves it escaped", async () => {
    const view = await open(table);
    let math = "";
    view.state.doc.descendants((n) => {
      if (n.type.name === "math_inline") math = n.textContent;
    });
    expect(math).toBe("x | y");
    expect(saved(view)).toContain("| $x \\| y$ |");
  });

  it("saves a bar typed into a cell's formula as \\|", async () => {
    const view = await open("| a |\n| - |\n| $x$ |");
    let at = -1;
    view.state.doc.descendants((n, pos) => {
      if (n.type.name === "math_inline") at = pos + 2;
    });
    view.dispatch(view.state.tr.insertText(" | z", at));
    expect(saved(view)).toContain("$x | z$".replace("|", "\\|"));
  });
});
