// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../../document-view/editor-test-harness";

vi.mock("mermaid", () => ({
  default: { initialize() {}, render: () => new Promise(() => {}) },
}));
const css = (globalThis.CSS ?? {}) as { escape?: (value: string) => string };
css.escape ??= (value) => value.replace(/["\\]/g, "\\$&");
(globalThis as { CSS?: unknown }).CSS = css;

let editor: Editor | null = null;
afterEach(async () => {
  await editor?.destroy();
  editor = null;
});

async function viewAt(markdown: string, inText: string): Promise<EditorView> {
  editor = await createTestEditor(markdown);
  const view = editor.ctx.get(editorViewCtx);
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(inText))
      at = pos + node.text!.indexOf(inText);
  });
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, at)),
  );
  return view;
}

const pressSelectAll = (view: EditorView) =>
  view.someProp("handleKeyDown", (handle) =>
    handle(view, new KeyboardEvent("keydown", { key: "a", ctrlKey: true })),
  );

const selected = (view: EditorView) => {
  const { from, to } = view.state.selection;
  return view.state.doc.textBetween(from, to, "\n");
};

it("selects a code block's code first, then the whole document", async () => {
  const view = await viewAt(
    "Before\n\n```js\nlet a = 1;\nlet b = 2;\n```\n\nAfter\n",
    "b = 2",
  );
  pressSelectAll(view);
  expect(selected(view)).toBe("let a = 1;\nlet b = 2;");
  pressSelectAll(view);
  expect(selected(view)).toBe("Before\nlet a = 1;\nlet b = 2;\nAfter");
});

it("selects the whole document from a paragraph at once", async () => {
  const view = await viewAt("One\n\nTwo\n", "Two");
  pressSelectAll(view);
  expect(selected(view)).toBe("One\nTwo");
});
