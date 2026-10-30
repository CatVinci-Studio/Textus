// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { editorViewCtx, serializerCtx, type Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditProposal } from "../../ai/types";
import { createTestEditor } from "../editor-test-harness";
import { applyPluginEdits } from "./plugin-edits";

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

/** `text` inserted at the end of `markdown`'s last paragraph, as a
 *  plugin's insertText does; the document's Markdown after. */
async function insertAtEnd(markdown: string, text: string): Promise<string> {
  editor = await createTestEditor(markdown);
  const view = editor.ctx.get(editorViewCtx);
  const end = view.state.doc.content.size - 1;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, end)),
  );
  applyPluginEdits(editor.ctx, [
    { action: "insert_at_cursor", text } as EditProposal,
  ]);
  return editor.ctx.get(serializerCtx)(view.state.doc).trim();
}

// The documents' trailing spaces go as they are read; the marks stay.
it("keeps a wiki link or bold words that start what is inserted", async () => {
  expect(await insertAtEnd("See ", "[[Trip]]")).toBe("See[[Trip]]");
  expect(await insertAtEnd("Note: ", "**bold** words")).toBe(
    "Note:**bold** words",
  );
});
