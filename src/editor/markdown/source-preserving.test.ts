// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, parserCtx, serializerCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../../document-view/editor-test-harness";
import {
  detectFormat,
  toEditorText,
  toFileText,
} from "../../document/file-format";
import { readSourceBlocks, writePreservingSource } from "./source-preserving";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

/** Where top-level block `index` starts. */
function blockStart(doc: ProseNode, index: number): number {
  let pos = 0;
  for (let j = 0; j < index; j++) pos += doc.child(j).nodeSize;
  return pos;
}

/** Where the text of top-level block `index` (its first textblock) ends. */
function endOfBlock(doc: ProseNode, index: number): number {
  const pos = blockStart(doc, index);
  const block = doc.child(index);
  if (block.isTextblock) return pos + block.nodeSize - 1;
  let end = -1;
  block.descendants((node, offset) => {
    if (end < 0 && node.isTextblock) end = pos + 1 + offset + node.nodeSize - 1;
    return end < 0;
  });
  return end;
}

/** Types `text` at the end of top-level block `index`. */
const typeInto =
  (index: number, text = " edited") =>
  (view: EditorView) =>
    view.dispatch(
      view.state.tr.insertText(text, endOfBlock(view.state.doc, index)),
    );

/** Deletes top-level block `index`. */
const deleteBlock = (index: number) => (view: EditorView) => {
  const { doc } = view.state;
  const from = blockStart(doc, index);
  view.dispatch(view.state.tr.delete(from, from + doc.child(index).nodeSize));
};

/** Opens `markdown`, makes `edit`, and returns what a save writes. */
async function saveAfter(
  markdown: string,
  edit: (view: EditorView) => void,
): Promise<string> {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const source = readSourceBlocks(ctx, markdown, view.state.doc);
    expect(source).not.toBeNull();
    edit(view);
    return writePreservingSource(ctx, source!, view.state.doc);
  });
}

/** What the editor reads `markdown` as, for comparing two files' meaning. */
async function readAs(markdown: string): Promise<ProseNode> {
  const editor = await createTestEditor("");
  editors.push(editor);
  return editor.action((ctx) => ctx.get(parserCtx)(markdown));
}

describe("saving after an edit elsewhere keeps as written", () => {
  it.each([
    ["underscore emphasis", "Some _em_ and __strong__ text"],
    ["a strikethrough", "Some ~~struck~~ text"],
    ["a setext heading", "Title\n====="],
    ["a setext subheading", "Subtitle\n--------"],
    ["an unpadded table", "| a | b |\n|---|:-:|\n| 1 | 22 |"],
    ["snake_case", "a snake_case name"],
    ["a [1] citation", "As shown [1], and [2, 3]."],
    ["an &nbsp;", "a&nbsp;b &amp; c"],
    ["a 1. 1. 1. list", "1. one\n1. two\n1. three"],
    ["a wide list indent", "-   wide\n-   indent\n\n    more"],
    ["a two-space hard break", "line one  \nline two"],
    ["a wikilink", "See [[Page]], [[Page|shown]] and [[Note#Heading]]."],
    ["a #tag", "#tag at the start of a line"],
    ["a star rule", "* * *"],
    ["an indented code block", "    code"],
    ["an autolink in angle brackets", "<https://x.org>"],
    ["an HTML comment", "<!-- note -->"],
  ])("%s", async (_name, block) => {
    const markdown = `Edit me\n\n${block}\n\nAnd me\n`;
    expect(await saveAfter(markdown, typeInto(0))).toBe(
      `Edit me edited\n\n${block}\n\nAnd me\n`,
    );
    expect(await saveAfter(markdown, typeInto(2))).toBe(
      `Edit me\n\n${block}\n\nAnd me edited\n`,
    );
  });

  it("writes an untouched document back byte for byte", async () => {
    const markdown =
      "Title\n=====\n\n\n_em_ and __strong__\n\n* a\n* b\n\n[r]: https://x.org\n";
    expect(await saveAfter(markdown, () => {})).toBe(markdown);
  });

  it("writes an edit that was undone back byte for byte", async () => {
    const markdown = "Title\n=====\n\n_em_ text\n";
    const editor = await createTestEditor(markdown);
    editors.push(editor);
    const out = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const before = view.state.doc;
      const source = readSourceBlocks(ctx, markdown, before)!;
      typeInto(1)(view);
      // As undo leaves it: the block's old node back in place.
      const { doc } = view.state;
      view.dispatch(
        view.state.tr.replaceWith(
          blockStart(doc, 1),
          blockStart(doc, 1) + doc.child(1).nodeSize,
          before.child(1),
        ),
      );
      return writePreservingSource(ctx, source, view.state.doc);
    });
    expect(out).toBe(markdown);
  });

  it("keeps a reference link's definitions", async () => {
    const markdown =
      'A [link][r], a [collapsed][] one and a [shortcut].\n\nEdit me\n\n[r]: https://x.org\n[collapsed]: https://y.org "Why"\n[shortcut]: <https://z.org>\n';
    expect(await saveAfter(markdown, typeInto(1))).toBe(
      markdown.replace("Edit me", "Edit me edited"),
    );
  });

  it("writes a reference link in an edited block as a reference", async () => {
    const markdown =
      "A [link][r], a [collapsed][] one and a [shortcut].\n\n[r]: https://x.org\n\n[collapsed]: https://y.org\n\n[shortcut]: https://z.org\n";
    expect(await saveAfter(markdown, typeInto(0, " More"))).toBe(
      markdown.replace("[shortcut].", "[shortcut]. More"),
    );
  });

  it("writes a reference image in an edited block as a reference", async () => {
    const markdown = "An ![image][pic] here\n\n[pic]: a.png\n";
    expect(await saveAfter(markdown, typeInto(0))).toBe(
      "An ![image][pic] here edited\n\n[pic]: a.png\n",
    );
  });

  it("writes wikilinks and a #tag in an edited block as written", async () => {
    const markdown = "#idea [[Page]] and [[a_b|the *b*]] _x_\n";
    expect(await saveAfter(markdown, typeInto(0))).toBe(
      "#idea [[Page]] and [[a_b|the *b*]] _x_ edited\n",
    );
  });

  it("still escapes a # that would open a heading", async () => {
    const out = await saveAfter("Edit me\n", (view) => {
      const end = endOfBlock(view.state.doc, 0);
      view.dispatch(view.state.tr.insertText("# not a heading", 1, end));
    });
    expect(out).toBe("\\# not a heading\n");
  });

  it("serializes the changed block in the editor's own style", async () => {
    const markdown = "__em__ here\n\nTitle\n=====\n";
    expect(await saveAfter(markdown, typeInto(0))).toBe(
      "**em** here edited\n\nTitle\n=====\n",
    );
  });

  it("keeps front matter exactly", async () => {
    const markdown = "---\ntitle:  x\n---\n\nEdit me\n";
    expect(await saveAfter(markdown, typeInto(1))).toBe(
      "---\ntitle:  x\n---\n\nEdit me edited\n",
    );
  });

  it("keeps the blank lines between untouched blocks only", async () => {
    const markdown = "a\n\n\n\nb\n\n\n\nc\n";
    expect(await saveAfter(markdown, typeInto(2))).toBe(
      "a\n\n\n\nb\n\nc edited\n",
    );
  });

  it("writes nothing for an empty paragraph added at the end", async () => {
    const markdown = "_a_\n\n```\ncode\n```\n";
    const out = await saveAfter(markdown, (view) => {
      const { doc, schema } = view.state;
      view.dispatch(
        view.state.tr.insert(doc.content.size, schema.nodes.paragraph.create()),
      );
    });
    expect(out).toBe(markdown);
  });

  it("keeps a missing final newline", async () => {
    expect(await saveAfter("_a_\n\nb", typeInto(0))).toBe("_a_ edited\n\nb");
    expect(await saveAfter("_a_\n\nb", typeInto(1))).toBe("_a_\n\nb edited");
  });

  it("serializes a list an item of which changed", async () => {
    // A list is one block: an edit in it serializes the whole list.
    const markdown = "Para _x_\n\n* a\n* b\n";
    expect(await saveAfter(markdown, typeInto(1))).toBe(
      "Para _x_\n\n* a edited\n* b\n",
    );
  });

  it("keeps blocks that were moved", async () => {
    const markdown = "_one_\n\n_two_\n\n_three_\n";
    const out = await saveAfter(markdown, (view) => {
      const first = view.state.doc.child(0);
      const tr = view.state.tr.delete(0, first.nodeSize);
      view.dispatch(tr.insert(tr.doc.content.size, first));
    });
    expect(out).toBe("_two_\n\n_three_\n\n_one_\n");
  });

  it("serializes two lists that would merge once next to each other", async () => {
    const out = await saveAfter("- a\n\nbetween\n\n- b\n", deleteBlock(1));
    const doc = await readAs(out);
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).type.name).toBe("bullet_list");
    expect(doc.child(1).type.name).toBe("bullet_list");
  });

  it("doesn't open front matter with a rule that becomes the first block", async () => {
    const out = await saveAfter(
      "Lead\n\n---\n\ntitle: x\n\n---\n",
      deleteBlock(0),
    );
    expect(out.startsWith("---")).toBe(false);
    expect((await readAs(out)).child(0).type.name).toBe("hr");
  });

  it("keeps an indented code block from joining a list before it", async () => {
    const out = await saveAfter("- item\n\npara\n\n    code\n", deleteBlock(1));
    const doc = await readAs(out);
    expect(doc.childCount).toBe(2);
    expect(doc.child(1).type.name).toBe("code_block");
  });

  it("keeps a file's own <br> through an edit elsewhere", async () => {
    // A heading's id is set by a transaction on opening, which must not turn
    // the file's <br>s into breaks.
    const markdown =
      "# Title\n\n- one<br>\n  two\n- **bold**<br>more\n\nEdit me\n";
    expect(await saveAfter(markdown, typeInto(2))).toBe(
      markdown.replace("Edit me", "Edit me edited"),
    );
  });

  it("keeps two code blocks apart when the paragraph between them is emptied", async () => {
    // An empty paragraph writes nothing, so the blocks on either side of
    // it meet: indented code merges, as two lists would.
    const out = await saveAfter("    one\n\npara\n\n    two\n", (view) => {
      const from = blockStart(view.state.doc, 1) + 1;
      view.dispatch(view.state.tr.delete(from, from + "para".length));
    });
    const doc = await readAs(out);
    expect(doc.childCount).toBe(2);
    expect(doc.child(1).textContent).toBe("two");
  });

  it("keeps a block's first-line indent when a block goes in before it", async () => {
    // The space before the marker puts "two" outside the item, as code.
    const markdown = " -    one\n\n     two\n";
    const out = await saveAfter(markdown, (view) => {
      const { schema } = view.state;
      view.dispatch(
        view.state.tr.insert(
          0,
          schema.nodes.heading.create({ level: 2 }, schema.text("New")),
        ),
      );
    });
    expect(out).toBe(`## New\n\n${markdown}`);
  });

  it("checks a list's join with an indented definition elsewhere", async () => {
    // The definitions are read after each join; indented, they joined a list,
    // so blocks around it would serialize too.
    const markdown =
      "Intro _x_\n\n  [r]: https://x.org\n  [s]: https://y.org\n\nPara _y_\n";
    const out = await saveAfter(markdown, (view) => {
      const { schema, doc } = view.state;
      const item = schema.nodes.list_item.create(
        null,
        schema.nodes.paragraph.create(null, schema.text("a")),
      );
      const list = schema.nodes.bullet_list.create(null, item);
      view.dispatch(view.state.tr.insert(doc.content.size, list));
    });
    expect(out).toBe(`${markdown}\n* a\n`);
  });

  it("doesn't bring back a deleted definition a setext heading was read with", async () => {
    // The heading's position starts at the definition's line.
    const markdown = "[foo]: /url\nbar\n===\n\n[foo]\n";
    const out = await saveAfter(markdown, deleteBlock(0));
    expect(out).toBe("bar\n===\n\n[foo]\n");
  });

  it("keeps a Windows file's line endings and BOM through an edit", async () => {
    const raw = "﻿Title\r\n=====\r\n\r\n_em_ text\r\n";
    const out = await saveAfter(toEditorText(raw), typeInto(1));
    expect(toFileText(out, detectFormat(raw))).toBe(
      "﻿Title\r\n=====\r\n\r\n_em_ text edited\r\n",
    );
  });
});

describe("saving a long document", () => {
  it("writes only the changed block, faster than the whole document", async () => {
    const kinds = [
      (i: number) => `Section ${i}\n----------`,
      (i: number) => `Paragraph ${i} with _em_ and snake_case words.`,
      (i: number) => `- item ${i}\n- item ${i + 1}\n    - nested`,
      (i: number) => "```js\nconst x = " + i + ";\n```",
      (i: number) => `| a | b |\n|---|---|\n| ${i} | y |`,
    ];
    const markdown =
      Array.from({ length: 1000 }, (_, i) => kinds[i % kinds.length](i)).join(
        "\n\n",
      ) + "\n";
    const editor = await createTestEditor(markdown);
    editors.push(editor);
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      expect(view.state.doc.childCount).toBe(1000);
      const source = readSourceBlocks(ctx, markdown, view.state.doc)!;
      typeInto(501, "!")(view);
      const { doc } = view.state;
      const started = performance.now();
      const out = writePreservingSource(ctx, source, doc);
      const preserving = performance.now() - started;
      const before = performance.now();
      ctx.get(serializerCtx)(doc);
      const whole = performance.now() - before;
      expect(out).toBe(
        markdown.replace(
          "Paragraph 501 with _em_ and snake_case words.",
          "Paragraph 501 with _em_ and snake_case words.!",
        ),
      );
      // The whole document is the cost without preservation; the changed block
      // alone is a small part of it.
      expect(preserving).toBeLessThan(whole);
    });
  }, 60_000);
});
