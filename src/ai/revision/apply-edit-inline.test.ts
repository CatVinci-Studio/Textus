// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { editorViewCtx, serializerCtx, type Editor } from "@milkdown/kit/core";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { replaceWithMarkdown } from "./apply-edit";

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

/** `text` written at the end of `markdown`'s paragraph, as an AI edit in a
 *  sentence is; the document's Markdown after. */
async function writeAtEnd(markdown: string, text: string): Promise<string> {
  editor = await createTestEditor(markdown);
  const view = editor.ctx.get(editorViewCtx);
  const end = view.state.doc.content.size - 1;
  view.dispatch(replaceWithMarkdown(view.state.tr, editor.ctx, end, end, text));
  return editor.ctx.get(serializerCtx)(view.state.doc).trim();
}

// The documents' trailing spaces go as they are read; the marks stay.
it("keeps a wiki link or bold words that start what is written", async () => {
  expect(await writeAtEnd("See ", "[[Trip]]")).toBe("See[[Trip]]");
  expect(await writeAtEnd("Note: ", "**bold** words")).toBe(
    "Note:**bold** words",
  );
});
