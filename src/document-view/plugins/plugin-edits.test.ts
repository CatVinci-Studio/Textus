// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { editorViewCtx, serializerCtx, type Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditProposal } from "../../ai/types";
import { createTestEditor } from "../editor-test-harness";
import { applyPluginEdits } from "./plugin-edits";
import { serializeBlocks } from "../../editor/markdown/doc-markdown";

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

// The Tasks plugin moves a ticked task after the open ones by writing its
// list again: the caret stays in the list, and the view is left alone.
it("keeps the caret where it was when a block is written again", async () => {
  editor = await createTestEditor(
    "# Notes\n\nIntro.\n\n- [x] done\n- [ ] open\n\nAfter.",
  );
  const view = editor.ctx.get(editorViewCtx);
  const blocks = serializeBlocks(editor.ctx, view.state.doc);
  const list = blocks.find((b) => b.kind === "list")!;
  const at = list.from + 4;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, at)),
  );
  applyPluginEdits(editor.ctx, [
    { action: "replace", block: list.id, text: "- [ ] open\n- [x] done" },
  ] as EditProposal[]);
  const { from } = view.state.selection;
  expect(from).toBeGreaterThan(list.from);
  expect(from).toBeLessThan(list.to);
  expect(editor.ctx.get(serializerCtx)(view.state.doc)).toContain(
    "- [ ] open\n- [x] done",
  );
  // Words selected elsewhere stay selected.
  const intro = blocks.find((b) => b.kind === "paragraph")!;
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, intro.from + 1, intro.from + 4),
    ),
  );
  const again = serializeBlocks(editor.ctx, view.state.doc).find(
    (b) => b.kind === "list",
  )!;
  applyPluginEdits(editor.ctx, [
    { action: "replace", block: again.id, text: "- [x] done\n- [ ] open" },
  ] as EditProposal[]);
  expect(view.state.selection.empty).toBe(false);
  expect(
    view.state.doc.textBetween(
      view.state.selection.from,
      view.state.selection.to,
    ),
  ).toBe("Int");
});
