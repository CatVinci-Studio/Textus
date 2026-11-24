// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../editor-test-kit";
import { TALL_LINE_ATTR } from "./list-tall-line-plugin";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

async function open(markdown: string): Promise<EditorView> {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) => ctx.get(editorViewCtx));
}

/** Each item's first line's text, and whether it is marked tall. */
function marked(view: EditorView): [string, boolean][] {
  return [...view.dom.querySelectorAll("li")].map((li) => [
    li.querySelector("p")?.textContent?.trim() ?? "",
    li.hasAttribute(TALL_LINE_ATTR),
  ]);
}

/** Where the paragraph reading `text` starts its content. */
function paragraphAt(view: EditorView, text: string): number {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.type.name === "paragraph" && node.textContent === text)
      at = pos + 1;
  });
  return at;
}

describe("a list item whose first line holds maths or a picture", () => {
  it("is marked, nested ones and tasks too, the rest not", async () => {
    const view = await open(
      [
        "- plain",
        "- with $x^2$ maths",
        "  - nested ![p](p.png)",
        "  - nested plain",
        "1. numbered $y$",
        "- [ ] task $z$",
        "- bold **$b$** inside",
        "- first plain",
        "",
        "  second $w$",
      ].join("\n"),
    );
    const tall = marked(view)
      .filter(([, on]) => on)
      .map(([text]) => text.split(" ")[0]);
    expect(tall).toEqual(["with", "nested", "numbered", "task", "bold"]);
    expect(marked(view).find(([t]) => t === "nested plain")?.[1]).toBe(false);
    expect(marked(view).find(([t]) => t === "first plain")?.[1]).toBe(false);
  });

  it("follows an edit to the item", async () => {
    const view = await open("- plain\n- other\n");
    const at = paragraphAt(view, "plain");
    const math = view.state.schema.nodes.math_inline!.create(
      null,
      view.state.schema.text("a+b"),
    );
    view.dispatch(view.state.tr.insert(at, math));
    expect(marked(view).map(([, on]) => on)).toEqual([true, false]);
    view.dispatch(view.state.tr.delete(at, at + math.nodeSize));
    expect(marked(view).map(([, on]) => on)).toEqual([false, false]);
  });
});
