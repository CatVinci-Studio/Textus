// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { createTestEditor } from "./editor-test-harness";
import fixture from "../../src-tauri/src/extract/testdata/word-text.json";
import markdown from "../../src-tauri/src/extract/testdata/word-text.md?raw";

// A Word document opened in Textus (document/word-import.ts) is the
// backend's Markdown of it, with the text escaped so it reads back as the
// words the Word file holds. The backend's test turns word-text.json into a
// .docx and checks that it converts to word-text.md, read back by a
// CommonMark parser (src-tauri/src/extract/docx.rs); this reads the same
// Markdown with the editor itself, whose own syntax - ==highlight==, $maths$,
// wikilinks - a CommonMark parser doesn't know.

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

it("reads a Word document's escaped text back as the same words", async () => {
  editor = await createTestEditor(markdown);
  const doc = editor.ctx.get(editorViewCtx).state.doc;
  const texts: string[] = [];
  // Anything the editor made of the text besides text and line breaks -
  // emphasis, a link, a maths or highlight node - is Markdown the escaping
  // missed.
  const markup: string[] = [];
  doc.descendants((node) => {
    if (node.isTextblock) {
      texts.push(
        node.textBetween(0, node.content.size, undefined, (leaf) =>
          leaf.type.name === "hardbreak" ? "\n" : "",
        ),
      );
      node.descendants((inline) => {
        if (inline.isText)
          markup.push(...inline.marks.map((mark) => mark.type.name));
        else if (inline.type.name !== "hardbreak")
          markup.push(inline.type.name);
      });
      return false;
    }
    return true;
  });
  expect(markup).toEqual([]);
  expect(texts).toEqual([
    fixture.heading,
    ...fixture.paragraphs,
    ...fixture.table.flat(),
  ]);
});
