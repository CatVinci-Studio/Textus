// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { editorViewCtx, serializerCtx, type Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../document-view/editor-test-harness";
import { insertMathBlock, insertRule, makeTasks } from "./insert-blocks";

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

/** The editor on `markdown`, the caret at the end of its text `at`. */
async function viewAt(markdown: string, at: string): Promise<EditorView> {
  editor = await createTestEditor(markdown);
  const view = editor.ctx.get(editorViewCtx);
  let pos = -1;
  view.state.doc.descendants((node, p) => {
    if (pos < 0 && node.isText && node.text!.includes(at))
      pos = p + node.text!.indexOf(at) + at.length;
  });
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
  );
  return view;
}

const markdown = () =>
  editor!.ctx.get(serializerCtx)(editor!.ctx.get(editorViewCtx).state.doc);

it("puts a formula where the empty line was, the caret in it", async () => {
  const view = await viewAt("Before\n", "Before");
  view.dispatch(view.state.tr.split(view.state.selection.from));
  expect(insertMathBlock(view)).toBe(true);
  view.dispatch(view.state.tr.insertText("E=mc^2"));
  expect(markdown().trim()).toBe("Before\n\n$$\nE=mc^2\n$$");
});

it("puts a divider after a line of text, and goes on below it", async () => {
  const view = await viewAt("Some words\n", "words");
  expect(insertRule(view)).toBe(true);
  view.dispatch(view.state.tr.insertText("Next"));
  expect(markdown().trim()).toBe("Some words\n\n---\n\nNext");
});

it("turns the bullet list at the caret into tasks", async () => {
  const view = await viewAt("- one\n- two\n", "two");
  expect(makeTasks(view)).toBe(true);
  expect(markdown().trim()).toBe("- [ ] one\n- [ ] two");
});
