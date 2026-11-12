// @vitest-environment jsdom
import { linkHref } from "./link-syntax";
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { createTestEditor } from "../editor-test-kit";

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
    const link = doc.firstChild!.firstChild!;
    expect(link.type.name).toBe("link");
    expect(linkHref(link.textContent)).toBe("https://x.org");
  });

  it("leaves an embed an embed", async () => {
    const { doc } = await open("![[pic.png]]\n");
    expect(wikilinks(doc)).toEqual([]);
  });
});
