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

  it("put in as text in one go, makes wikilinks as the file reads them", async () => {
    const editor = await createTestEditor("x\n");
    editors.push(editor);
    const { wikilinksIn } = await import("./wikilink");
    const doc = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const tr = view.state.tr.insertText("[[a]] and [[1]](https://x.org)", 1);
      wikilinksIn(tr, 1, tr.doc.content.size - 1);
      return tr.doc;
    });
    expect(wikilinks(doc)).toEqual(["[[a]]"]);
  });

  it("leaves an embed an embed", async () => {
    const { doc } = await open("![[pic.png]]\n");
    expect(wikilinks(doc)).toEqual([]);
  });
});

// The two double-bracket syntaxes, `[[...]]` and `![[...]]`, read and saved
// alike: [what follows "a ", wikilink read?, embed read?, saved as the
// wikilink, saved as the embed] (null: saved as written).
const BRACKETS: [string, boolean, boolean, string | null, string | null][] = [
  ["[[Note b", false, false, "\\[\\[Note b", "!\\[\\[Note b"],
  ["[[No]te]] b", false, false, "\\[\\[No]te]] b", "!\\[\\[No]te]] b"],
  ["[[Note|text]] b", true, true, null, null],
  ["[[Note#Head]] b", true, true, null, null],
  ["[[No\nte]] b", false, false, "\\[\\[No\nte]] b", "!\\[\\[No\nte]] b"],
  ["[[]] b", false, false, "\\[\\[]] b", "!\\[\\[]] b"],
  ["[[x[y]] b", false, false, "\\[\\[x\\[y]] b", "!\\[\\[x\\[y]] b"],
  ["[[x]](u) b", false, true, null, "![[x]]\\(u) b"],
  ["[[a_b]] and _c_ b", true, true, null, null],
];

describe("double brackets, with and without the !", () => {
  const nodes = (doc: ProseNode) => {
    const found: string[] = [];
    doc.descendants((node) => {
      if (node.type.name === "wikilink" || node.type.name === "obsidian_embed")
        found.push(`${node.type.name}:${node.textContent}`);
    });
    return found;
  };
  const sourceOf = (text: string) => /^!?\[\[[^\s]*?\]\]/.exec(text)![0];

  it.each(BRACKETS)("%j", async (text, link, embed, linkSaved, embedSaved) => {
    for (const [bang, read, saved, type] of [
      ["", link, linkSaved, "wikilink"],
      ["!", embed, embedSaved, "obsidian_embed"],
    ] as const) {
      const markdown = `a ${bang}${text}\n`;
      const { doc, saved: out } = await open(markdown);
      expect(nodes(doc)).toEqual(
        read ? [`${type}:${sourceOf(bang + text)}`] : [],
      );
      expect(out).toBe(saved === null ? markdown : `a ${saved}\n`);
    }
  });

  it("reads either right after a word, and neither in inline code", async () => {
    for (const bang of ["", "!"]) {
      const word = await open(`a word${bang}[[Note]] b\n`);
      expect(nodes(word.doc)).toHaveLength(1);
      expect(word.saved).toBe(`a word${bang}[[Note]] b\n`);
      const code = await open(`a \`${bang}[[Note]]\` b\n`);
      expect(nodes(code.doc)).toEqual([]);
      expect(code.saved).toBe(`a \`${bang}[[Note]]\` b\n`);
    }
  });
});
