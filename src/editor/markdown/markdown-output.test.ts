// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { DOMParser, DOMSerializer } from "@milkdown/kit/prose/model";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { unwrittenImageSrcs } from "./markdown-output";
import { withImageWidth } from "../images/image-html";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

/** Opens `markdown` in the full editor chain and saves it straight back. */
async function roundTrip(markdown: string): Promise<string> {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) =>
    ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
  );
}

/** Opens `markdown`, sends it through HTML the way Milkdown's clipboard
 *  plugin pastes plain text, and saves what comes back. */
async function throughClipboard(markdown: string): Promise<string> {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) => {
    const { doc, schema } = ctx.get(editorViewCtx).state;
    const dom = DOMSerializer.fromSchema(schema).serializeFragment(doc.content);
    return ctx.get(serializerCtx)(DOMParser.fromSchema(schema).parse(dom));
  });
}

describe("saved markdown stays as written", () => {
  it.each([
    ["a tight bullet list", "* 一\n* 二\n"],
    ["a loose bullet list", "* 一\n\n* 二\n"],
    ["a nested tight list", "* 一\n  * 子\n* 二\n"],
    ["a task list", "* [ ] 待办\n* [x] 完成\n"],
    ["dash bullets", "- 一\n- 二\n  - 子\n"],
    ["plus bullets", "+ a\n+ b\n"],
    ["dash task items", "- [ ] 待办\n- [x] 完成\n"],
    ["empty task items", "- [ ] \n- [x] \n"],
    [
      "a nested empty task item",
      "- [ ] 待办\n  - [ ] \n- [x] \n  - [x] 完成\n",
    ],
    ["an escaped box, which is text", "- \\[ ]\n"],
    ["an ordered list", "1. 一\n2. 二\n"],
    ["a list starting at 3", "3. 三\n4. 四\n"],
    ["CJK bold", "中文**加粗**中文\n"],
    ["frontmatter", "---\ntitle: t\n---\n\n正文\n"],
    [
      "a <br> in a table cell",
      "| a      | b |\n| ------ | - |\n| x<br>y | z |\n",
    ],
    ["a link around inline code", "Via [`[catvinci]`](https://x.org/r) repo\n"],
    ["a link with code inside", "[see `code` here](u) after\n"],
    ["a link with math inside", "[see $x$ here](u) after\n"],
    ["inline math", "$x$ and $y_1$\n"],
    ["inline math in two dollars", "a $$x$$ b\n"],
    ["a paragraph of inline $$ math", "$$x^2$$\n"],
    ["inline math holding a dollar", "a $$x \\$ y$$ b\n"],
    ["a GitHub alert", "> [!NOTE]\n> 提示\n"],
    ["a lower-case alert", "> [!note]\n> 提示\n"],
    ["a capitalised alert", "> [!Tip]\n> 提示\n"],
    ["a folded Obsidian callout", "> [!tip]-\n> 提示\n"],
    ["an unfolded Obsidian callout", "> [!tip]+\n> 提示\n"],
    ["an Obsidian callout type", "> [!question]\n> 提示\n"],
    ["a tag at the start of a line", "#tag and #other\n"],
    ["a tag of two hashes", "##tag\n"],
    ["an escaped heading marker", "\\# not a heading\n"],
    ["an escaped lone hash", "\\#\n"],
    ["a wikilink", "See [[Page]] and [[Page|shown]]\n"],
    ["an equals sign", "2+2=4 and a = b\n"],
    ["equals signs in a row", "x == y but not ==mark==\n"],
    ["a literal == that would open a highlight", "a \\==b== stays text\n"],
    ["a highlight", "一段==高亮==文字\n"],
    ["a single-tilde subscript", "H~2~O\n"],
    ["single and double tildes", "~一~ and ~~二~~\n"],
    ["a single tilde around bold", "~a **b** c~\n"],
    ["a footnote", "正文[^1]\n\n[^1]: 脚注\n"],
    ["a code fence's meta", '```js title="a.js" {1,3}\nx\n```\n'],
    ["a code fence's line marks", "```py {1,3} linenums\nx\n```\n"],
    ["an image without a title", "![图](a.png)\n"],
    [
      "an image width an older Textus saved",
      '![图](a.png "{textus-width=30%}")\n',
    ],
    ["an image width", '<img src="assets/a.png" alt="图" width="50%">\n'],
    ["an <img> in a line", 'A <img src="a.png" width="30%"> icon\n'],
    ["a pixel width", "<img src='a b.png' width=320 />\n"],
    ["Typora's zoom", '<img src="a.png" alt="x" style="zoom:50%;" />\n'],
    ["an <img> with a height", '<img src="a.png" height="100">\n'],
    ["an autolink", "See <https://x.org/a> here\n"],
    ["a bare www link", "See www.x.org/a here\n"],
    ["a link whose text is its URL", "[https://x.org/a](https://x.org/a)\n"],
    ["an empty-text link", "See [](https://x.org/a) here\n"],
    ["a titled empty-text link", '[](https://x.org/a "t")\n'],
  ])("keeps %s", async (_name, markdown) => {
    expect(await roundTrip(markdown)).toBe(markdown);
  });

  it.each([
    ["an image", "![美女](https://x.org/a.jpg)\n"],
    ["an image without alt", "![](assets/a.png)\n"],
    ["a titled image", '![a](s.png "t")\n'],
    ["a sized image", '<img src="a.png" alt="x" width="50%">\n'],
  ])("keeps %s pasted as text, adding no title", async (_name, markdown) => {
    expect(await throughClipboard(markdown)).toBe(markdown);
  });

  it("pastes an older Textus's sized image as <img width>", async () => {
    expect(
      await throughClipboard('![x](a.png "Cap {textus-width=30%}")\n'),
    ).toBe('<img src="a.png" alt="x" title="Cap" width="30%">\n');
  });

  it("keeps HTML the editor now renders, byte for byte", async () => {
    const markdown = [
      "# Notes",
      "",
      "<details>",
      "<summary>Folded <b>markdown</b></summary>",
      "",
      "Some **bold** text and a [link](https://x.org).",
      "",
      "</details>",
      "",
      "<details open><summary>Inline</summary>Body text</details>",
      "",
      "<table>",
      '  <tr><th colspan="2" align="center">Head</th></tr>',
      '  <tr><td rowspan="2">a</td><td style="color: #c00">b</td></tr>',
      "</table>",
      "",
      'A <span style="color: red; font-weight: bold">styled</span> word and an icon <svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="teal"/></svg> inline.',
      "",
      '<svg width="40" height="20">',
      '  <rect width="40" height="20" rx="4" fill="#4a7"/>',
      "</svg>",
      "",
    ].join("\n");
    expect(await roundTrip(markdown)).toBe(markdown);
  });

  it("keeps the box of a task item whose text isn't typed yet", async () => {
    const editor = await createTestEditor("- [ ] a\n- [x] b\n  - [ ] c\n");
    editors.push(editor);
    const saved = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const texts: [number, number][] = [];
      view.state.doc.descendants((node, pos) => {
        if (node.isText) texts.push([pos, pos + node.nodeSize]);
      });
      const tr = view.state.tr;
      for (const [from, to] of texts.reverse()) tr.delete(from, to);
      view.dispatch(tr);
      return ctx.get(serializerCtx)(view.state.doc);
    });
    expect(saved).toBe("- [ ] \n- [x] \n  - [ ] \n");
  });

  it("leaves out a pasted image whose file is still being stored", async () => {
    const blob = "blob:tauri://localhost/0b6e";
    unwrittenImageSrcs.add(blob);
    try {
      expect(await roundTrip(`a ![](${blob}) b ![](x.png)\n`)).toBe(
        "a  b ![](x.png)\n",
      );
    } finally {
      unwrittenImageSrcs.delete(blob);
    }
    expect(await roundTrip(`![](${blob})\n`)).toBe(`![](${blob})\n`);
  });

  it("escapes an alert marker that doesn't open a quote", async () => {
    expect(await roundTrip("text [!NOTE] here\n")).toBe(
      "text \\[!NOTE] here\n",
    );
  });

  it.each([
    ["> [!note]\n> a\n", "md-alert-note"],
    ["> [!Tip]\n> a\n", "md-alert-tip"],
    ["> [!warning]-\n> a\n", "md-alert-warning"],
  ])("shows %j as an alert", async (markdown, className) => {
    const editor = await createTestEditor(markdown);
    editors.push(editor);
    const quote = editor.action((ctx) =>
      ctx.get(editorViewCtx).dom.querySelector("blockquote"),
    );
    expect(quote?.classList.contains(className)).toBe(true);
  });

  it("keeps a code fence's meta when its language is changed", async () => {
    const editor = await createTestEditor('```js title="a.js"\nx\n```\n');
    editors.push(editor);
    const saved = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const select = view.dom.querySelector("select")!;
      select.value = "typescript";
      select.dispatchEvent(new Event("change"));
      return ctx.get(serializerCtx)(view.state.doc);
    });
    expect(saved).toBe('```typescript title="a.js"\nx\n```\n');
  });

  it("keeps a code fence's meta pasted as HTML", async () => {
    expect(await throughClipboard('```js title="a.js"\nx\n```\n')).toBe(
      '```js title="a.js"\nx\n```\n',
    );
  });

  it("keeps a link on a bold word inside it", async () => {
    expect(await roundTrip("[**bold** text](u) after\n")).toContain("](u)");
    expect(await roundTrip("[**bold** text](u) after\n")).toContain(
      "[text](u)",
    );
  });

  it("reads dollar amounts as text, not math (Pandoc's rule)", async () => {
    expect(await roundTrip("about $4) and round's $19 ok\n")).toBe(
      "about \\$4) and round's \\$19 ok\n",
    );
    expect(await roundTrip("costs $5 and $6\n")).toBe("costs \\$5 and \\$6\n");
    expect(await roundTrip("a $ x$ b\n")).toBe("a \\$ x\\$ b\n");
  });

  it("shows an empty-text link's URL as its text", async () => {
    const editor = await createTestEditor("[](https://x.org/a)\n");
    editors.push(editor);
    const text = editor.action(
      (ctx) => ctx.get(editorViewCtx).state.doc.textContent,
    );
    expect(text).toBe("https://x.org/a");
  });

  it("writes a bare URL as an autolink, as before", async () => {
    expect(await roundTrip("See https://x.org/a here\n")).toBe(
      "See <https://x.org/a> here\n",
    );
  });

  it.each([
    ["a URL", "see https://x.org/a here", "see <https://x.org/a> here\n"],
    ["a www address", "see www.x.org here", "see www.x.org here\n"],
    ["an email address", "mail a@b.com now", "mail <a@b.com> now\n"],
  ])("writes %s typed as text unescaped", async (_name, typed, reopened) => {
    const editor = await createTestEditor("");
    editors.push(editor);
    const markdown = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText(typed, 1));
      return ctx.get(serializerCtx)(view.state.doc);
    });
    expect(markdown).toBe(`${typed}\n`);
    // Reopened, it is the autolink GitHub makes of it.
    expect(await roundTrip(markdown)).toBe(reopened);
  });

  it("writes a thematic break as '---', but '***' as the first block", async () => {
    expect(await roundTrip("段\n\n***\n")).toBe("段\n\n---\n");
    expect(await roundTrip("***\n\n段\n")).toBe("***\n\n段\n");
  });
});

describe("an image's width", () => {
  /** Opens `markdown`, gives its first image `widthPercent` the way the
   *  width menu does, and saves. */
  async function resized(
    markdown: string,
    widthPercent: number | null,
  ): Promise<string> {
    const editor = await createTestEditor(markdown);
    editors.push(editor);
    return editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      let pos = -1;
      view.state.doc.descendants((node, at) => {
        if (pos < 0 && node.type.name === "image") pos = at;
      });
      expect(pos).toBeGreaterThanOrEqual(0);
      const node = view.state.doc.nodeAt(pos)!;
      view.dispatch(
        view.state.tr.setNodeMarkup(
          pos,
          undefined,
          withImageWidth(node.attrs, widthPercent),
        ),
      );
      return ctx.get(serializerCtx)(view.state.doc);
    });
  }

  it("is saved as <img width>, and Auto saves it as Markdown again", async () => {
    expect(await resized("![图](assets/a.png)\n", 50)).toBe(
      '<img src="assets/a.png" alt="图" width="50%">\n',
    );
    expect(await resized('![x](a.png "Cap")\n', 30)).toBe(
      '<img src="a.png" alt="x" title="Cap" width="30%">\n',
    );
    expect(
      await resized('<img src="assets/a.png" alt="图" width="50%">\n', null),
    ).toBe("![图](assets/a.png)\n");
    expect(
      await resized('<img src="a.png" title="Cap" width="320">\n', null),
    ).toBe('![](a.png "Cap")\n');
  });

  it("moves out of an older Textus's title once it changes", async () => {
    expect(await resized('![x](a.png "Cap {textus-width=50%}")\n', 70)).toBe(
      '<img src="a.png" alt="x" title="Cap" width="70%">\n',
    );
    expect(await resized('![x](a.png "{textus-width=50%}")\n', null)).toBe(
      "![x](a.png)\n",
    );
  });

  it("keeps a path with spaces working both ways", async () => {
    expect(await resized("![a](<my pic.png>)\n", 50)).toBe(
      '<img src="my pic.png" alt="a" width="50%">\n',
    );
    expect(await resized('<img src="my pic.png" width="50%">\n', null)).toBe(
      "![](<my pic.png>)\n",
    );
  });

  it("reads an <img> as an image, a resized Typora one included", async () => {
    expect(
      await resized(
        'Text <img src="a.png" alt="x" style="zoom:50%;" /> more\n',
        50,
      ),
    ).toBe('Text <img src="a.png" alt="x" width="50%"> more\n');
  });

  it("leaves an <img> it can't carry as raw HTML", async () => {
    const editor = await createTestEditor('<img src="a.png" height="9">\n');
    editors.push(editor);
    const types = editor.action((ctx) => {
      const names: string[] = [];
      ctx.get(editorViewCtx).state.doc.descendants((node) => {
        names.push(node.type.name);
      });
      return names;
    });
    expect(types).toContain("html");
    expect(types).not.toContain("image");
  });
});
