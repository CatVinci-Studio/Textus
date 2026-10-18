// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { parseEmbed } from "./obsidian-embed";

describe("parseEmbed", () => {
  it("reads a path from the vault root", () => {
    expect(parseEmbed("![[attachments/xxx.gif]]")).toEqual({
      path: "attachments/xxx.gif",
      alt: "",
      width: null,
      height: null,
      isImage: true,
    });
  });

  it("reads a bare file name with spaces", () => {
    expect(parseEmbed("![[Pasted image 2024.png]]")?.path).toBe(
      "Pasted image 2024.png",
    );
  });

  it("reads a width, or a width and height, after the bar", () => {
    expect(parseEmbed("![[a.png|300]]")).toMatchObject({
      width: 300,
      height: null,
      alt: "",
    });
    expect(parseEmbed("![[a.png|300x200]]")).toMatchObject({
      width: 300,
      height: 200,
    });
  });

  it("reads anything else after the bar as alt text", () => {
    expect(parseEmbed("![[a.png|A cat|120]]")).toMatchObject({
      alt: "A cat",
      width: 120,
    });
  });

  it.each(["png", "JPG", "jpeg", "gif", "webp", "svg", "avif", "bmp"])(
    "takes a .%s file for an image",
    (ext) => {
      expect(parseEmbed(`![[a.${ext}]]`)?.isImage).toBe(true);
    },
  );

  it.each(["![[Note]]", "![[Note#Heading]]", "![[doc.pdf]]", "![[a.png#^b]]"])(
    "takes %s for something other than an image",
    (source) => {
      expect(parseEmbed(source)?.isImage).toBe(false);
    },
  );

  it.each(["![[]]", "[[a.png]]", "![a.png]]", "![[a\nb.png]]"])(
    "takes %s for no embed at all",
    (source) => {
      expect(parseEmbed(source)).toBeNull();
    },
  );
});

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

async function open(markdown: string) {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc;
    const embeds: string[] = [];
    doc.descendants((node) => {
      if (node.type.name === "obsidian_embed") embeds.push(node.textContent);
    });
    return { embeds, saved: ctx.get(serializerCtx)(doc) };
  });
}

describe("an Obsidian embed in a document", () => {
  it("is read as one embed, not as an image or a link", async () => {
    const { embeds } = await open("See ![[attachments/a_b_c.gif|300]] here\n");
    expect(embeds).toEqual(["![[attachments/a_b_c.gif|300]]"]);
  });

  it.each([
    ["an image embed", "![[attachments/xxx.gif]]\n"],
    ["a sized embed", "![[a.png|300x200]]\n"],
    ["an embed mid-sentence", "Before ![[a b.png|alt|40]] after\n"],
    ["a file name with underscores", "![[my_file_name_.png]]\n"],
    ["a note embed", "![[Note#Heading]]\n"],
    ["two embeds on a line", "![[a.png]] ![[b.png]]\n"],
    ["an embed in a list", "- ![[a.png]]\n- text\n"],
  ])("saves %s exactly as written", async (_name, markdown) => {
    expect((await open(markdown)).saved).toBe(markdown);
  });

  it("leaves a standard image alone", async () => {
    const { embeds, saved } = await open("![alt](a.png)\n");
    expect(embeds).toEqual([]);
    expect(saved).toBe("![alt](a.png)\n");
  });
});
