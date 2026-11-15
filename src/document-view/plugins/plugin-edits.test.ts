// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { editorViewCtx, serializerCtx, type Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditProposal } from "../../ai/types";
import { createTestEditor } from "../editor-test-harness";
import { applyPluginEdits, replaceDocument } from "./plugin-edits";
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

// An agent outside edits a cell and a paragraph after the table: the file
// comes back as one table, as written.
it("takes a file changed outside in a table cell and after it as one table", async () => {
  const table =
    "| 标签 | 正常 | 异常 |\n| --- | --- | --- |\n| 正常（228） | 201（88.16%） | 27（11.84%） |\n| 异常（228） | 32（14.04%） | 196（85.96%） |";
  editor = await createTestEditor(`${table}\n\n结论：一致。`);
  const view = editor.ctx.get(editorViewCtx);
  const next = `${table.replace("201（88.16%）", "201 （88.2%）")}\n\n结论：不一致。`;
  expect(replaceDocument(editor.ctx, next)).toBe(true);
  const tables: string[] = [];
  view.state.doc.forEach((n) => {
    if (n.type.name === "table") tables.push(n.textContent);
  });
  expect(tables).toHaveLength(1);
  expect(tables[0]).toContain("201 （88.2%）");
  expect(tables[0]).toContain("27（11.84%）");
});

// Blocks added or taken out right between two others: the neighbours stay,
// once each.
it("takes a block added or removed between two others without losing or doubling one", async () => {
  const table = "| a | b |\n| --- | --- |\n| 1 | 2 |";
  editor = await createTestEditor(`one\n\n${table}`);
  const blocks = () => {
    const names: string[] = [];
    editor!.ctx.get(editorViewCtx).state.doc.forEach((n) => {
      names.push(`${n.type.name}:${n.textContent}`);
    });
    return names;
  };
  expect(replaceDocument(editor.ctx, `one\n\n## Head\n\n${table}`)).toBe(true);
  expect(blocks()).toEqual(["paragraph:one", "heading:Head", "table:ab12"]);
  expect(replaceDocument(editor.ctx, `one\n\n${table}`)).toBe(true);
  expect(blocks()).toEqual(["paragraph:one", "table:ab12"]);
  expect(replaceDocument(editor.ctx, `one\n\n## H\n\ntwo`)).toBe(true);
  expect(replaceDocument(editor.ctx, `one\n\ntwo`)).toBe(true);
  expect(blocks()).toEqual(["paragraph:one", "paragraph:two"]);
});
