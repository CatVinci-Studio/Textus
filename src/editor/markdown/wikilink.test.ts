// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { parseWikilink } from "./wikilink";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

async function open(markdown: string) {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) => ({
    doc: ctx.get(editorViewCtx).state.doc,
    saved: ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
  }));
}

function wikilinks(doc: ProseNode): string[] {
  const found: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "wikilink") found.push(node.textContent);
  });
  return found;
}

describe("parseWikilink", () => {
  it("reads a note, a heading in it and the text shown", () => {
    expect(parseWikilink("[[Page]]")).toEqual({ note: "Page", heading: null });
    expect(parseWikilink("[[folder/Page|shown]]")).toEqual({
      note: "folder/Page",
      heading: null,
    });
    expect(parseWikilink("[[Page#Part two|see]]")).toEqual({
      note: "Page",
      heading: "Part two",
    });
  });

  it("reads a heading of this document", () => {
    expect(parseWikilink("[[#Intro]]")).toEqual({ note: "", heading: "Intro" });
  });

  it("reads nothing else", () => {
    expect(parseWikilink("[[]]")).toBeNull();
    expect(parseWikilink("[Page]")).toBeNull();
    expect(parseWikilink("[[a]] b")).toBeNull();
  });
});

describe("a wikilink in a file", () => {
  it("is read as one and saved as written", async () => {
    const markdown = "See [[Page]], [[a_b|the *b*]] and [[Note#Heading]].\n";
    const { doc, saved } = await open(markdown);
    expect(wikilinks(doc)).toEqual([
      "[[Page]]",
      "[[a_b|the *b*]]",
      "[[Note#Heading]]",
    ]);
    expect(saved).toBe(markdown);
  });

  it("isn't read inside code", async () => {
    const { doc, saved } = await open("`[[a]]`\n\n```\n[[b]]\n```\n");
    expect(wikilinks(doc)).toEqual([]);
    expect(saved).toBe("`[[a]]`\n\n```\n[[b]]\n```\n");
  });

  it("leaves a link whose text has brackets a link", async () => {
    const { doc } = await open("[[1]](https://x.org)\n");
    expect(wikilinks(doc)).toEqual([]);
    const text = doc.firstChild!.firstChild!;
    expect(text.text).toBe("[1]");
    expect(text.marks.map((mark) => mark.attrs.href)).toEqual([
      "https://x.org",
    ]);
  });

  it("leaves an embed an embed", async () => {
    const { doc } = await open("![[pic.png]]\n");
    expect(wikilinks(doc)).toEqual([]);
  });
});
