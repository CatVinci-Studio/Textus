// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { DOMParser, DOMSerializer } from "@milkdown/kit/prose/model";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { toggleSpan } from "../marks/span-commands";
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

  it.each([
    ["bold around code", "**a `b` c** and **`d`**\n"],
    ["italic and bold+italic around code", "*a `b`* and ***`c` d***\n"],
    ["strikethrough and highlight around code", "~~a `b` c~~ ==`d`==\n"],
    ["CJK bold around code", "中文**`代码`**中文\n"],
    ["a link in bold around code", "**[a `b` c](u)**\n"],
  ])("keeps %s, opened and pasted", async (_name, markdown) => {
    expect(await roundTrip(markdown)).toBe(markdown);
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
    const view = editor.action((ctx) => ctx.get(editorViewCtx));
    view.dom
      .querySelector(".code-block-wrapper")!
      .dispatchEvent(new Event("pointerenter"));
    const found = <T>(el: T | null | undefined): T => {
      if (!el) throw new Error("not drawn yet");
      return el;
    };
    const picker = await vi.waitFor(() =>
      found(view.dom.querySelector<HTMLElement>(".code-block-language-select")),
    );
    act(() => picker.click());
    const option = await vi.waitFor(() =>
      found(
        [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
          (o) => o.textContent === "typescript",
        ),
      ),
    );
    act(() => option.click());
    const saved = editor.action((ctx) =>
      ctx.get(serializerCtx)(view.state.doc),
    );
    expect(saved).toBe('```typescript title="a.js"\nx\n```\n');
  });

  it("keeps a code fence's meta pasted as HTML", async () => {
    expect(await throughClipboard('```js title="a.js"\nx\n```\n')).toBe(
      '```js title="a.js"\nx\n```\n',
    );
  });

  it("keeps a link on a bold word inside it", async () => {
    // One link, not `[**bold**](u) [text](u)`: the parser leaves the
    // link on the bold span's text only.
    expect(await roundTrip("[**bold** text](u) after\n")).toBe(
      "[**bold** text](u) after\n",
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

describe("an edited block is saved so it reads back the same", () => {
  // Each is an edit, then the block as the serializer writes it.

  /** Opens `markdown`, makes `edit`, and saves the whole document. */
  async function savedAfter(
    markdown: string,
    edit: (view: EditorView) => void,
  ): Promise<string> {
    const editor = await createTestEditor(markdown);
    editors.push(editor);
    return editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      edit(view);
      return ctx.get(serializerCtx)(view.state.doc);
    });
  }

  /** Where `text` starts in the document's text. */
  function find(doc: ProseNode, text: string): number {
    let at = -1;
    doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text!.includes(text))
        at = pos + node.text!.indexOf(text);
      return at < 0;
    });
    if (at < 0) throw new Error(`no ${text}`);
    return at;
  }

  const deleting = (text: string) => (view: EditorView) => {
    const at = find(view.state.doc, text);
    view.dispatch(view.state.tr.delete(at, at + text.length));
  };

  const typingAfter = (text: string, typed: string) => (view: EditorView) =>
    view.dispatch(
      view.state.tr.insertText(typed, find(view.state.doc, text) + text.length),
    );

  const boldening = (word: string) => (view: EditorView) => {
    const at = find(view.state.doc, word);
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, at, at + word.length),
      ),
    );
    toggleSpan(view, 2);
  };

  it("writes one link around bold made inside it", async () => {
    expect(await savedAfter("[a b c](u)\n", boldening("b"))).toBe(
      "[a **b** c](u)\n",
    );
    expect(await savedAfter("[The `match` Flow](u)\n", boldening("Flow"))).toBe(
      "[The `match` **Flow**](u)\n",
    );
  });

  it("keeps a link on everything inside a span in it", async () => {
    expect(
      await savedAfter("[link *foo `#`*](/uri)\n", typingAfter("link", "!")),
    ).toBe("[link! *foo `#`*](/uri)\n");
  });

  it("writes nothing for a span whose words were deleted", async () => {
    expect(await savedAfter("a **foo** b\n", deleting("foo"))).toBe("a  b\n");
    expect(await savedAfter("x *_foo_* y\n", deleting("foo"))).toBe("x  y\n");
    expect(await savedAfter("a `foo` b\n", deleting("foo"))).toBe("a  b\n");
    expect(await savedAfter("[a **b** c](u)\n", deleting("b"))).toBe(
      "[a  c](u)\n",
    );
  });

  it("moves the spaces at a span's ends outside it", async () => {
    expect(await savedAfter("x *Anno di 2005* y\n", deleting("2005"))).toBe(
      "x *Anno di*  y\n",
    );
    expect(await savedAfter("**foo *bar***\n", deleting("bar"))).toBe(
      "**foo** \n",
    );
  });

  it("moves the space out of bold-italic, past both its marks", async () => {
    // Italic around bold: the space was written inside the italic,
    // `***`e`** *`, which reads back as `*e *`.
    expect(await savedAfter("***`e` f***\n", deleting("f"))).toBe(
      "***`e`*** \n",
    );
    expect(await savedAfter("a ***e f*** b\n", deleting("f"))).toBe(
      "a ***e***  b\n",
    );
  });

  it("joins spans and code side by side, and parts formulas", async () => {
    expect(await savedAfter("foo**bar**\n", boldening("foo"))).toBe(
      "**foobar**\n",
    );
    expect(await savedAfter("`a`变为`b`\n", deleting("变为"))).toBe("`ab`\n");
    expect(await savedAfter("$a$ to $b$\n", deleting(" to "))).toBe(
      "$a$ $b$\n",
    );
  });

  it("doesn't escape brackets into LaTeX maths", async () => {
    const saved = await savedAfter(
      "[Tech [Episodes]](u)\n",
      typingAfter("Tech", "!"),
    );
    expect(saved).toBe("[Tech! \\[Episodes&#93;](u)\n");
    const editor = await createTestEditor(saved);
    editors.push(editor);
    expect(
      editor.action((ctx) => ctx.get(editorViewCtx).state.doc.textContent),
    ).toBe("Tech! [Episodes]");
  });

  it("doesn't escape a bracket into a LaTeX formula after it", async () => {
    // `\[', '\]` is a formula; the `[[` before it is escaped.
    const saved = await savedAfter(
      "x = [['\\[', '\\]']] end\n",
      deleting(" end"),
    );
    expect(saved).toBe("x = &#91;&#91;'\\[', '\\]']]\n");
    expect(await roundTrip(saved)).toBe(saved);
  });

  it("escapes text before a space at the start of a line", async () => {
    expect(await savedAfter("foo\n\\# bar baz\n", boldening("baz"))).toBe(
      "foo\n\\# bar **baz**\n",
    );
    expect(await savedAfter("> foo\n> \\- bar\n", deleting("bar"))).toBe(
      "> foo\n> \\- \n",
    );
    expect(await savedAfter("&#9;foo\n", boldening("foo"))).toBe(
      "&#x9;**foo**\n",
    );
  });

  it("closes bold that ends in punctuation before a word", async () => {
    // The space between the bold and the word deleted.
    const joining = (next: string) => (view: EditorView) => {
      const at = find(view.state.doc, ` ${next}`);
      view.dispatch(view.state.tr.delete(at, at + 1));
    };
    expect(await savedAfter("**per file.** after\n", joining("after"))).toBe(
      "**per file.**&#x61;fter\n",
    );
    const before = (view: EditorView) => {
      const at = find(view.state.doc, "foo ") + 3;
      view.dispatch(view.state.tr.delete(at, at + 1));
    };
    expect(await savedAfter("foo **(bar)**\n", before)).toBe(
      "fo&#x6F;**(bar)**\n",
    );
    expect(await savedAfter("*see [it](/u)* now\n", joining("now"))).toBe(
      "*see [it](/u)*&#x6E;ow\n",
    );
    // CJK text is read by remark-cjk-friendly as it stands.
    expect(await savedAfter("**「加粗」** 中文\n", joining("中文"))).toBe(
      "**「加粗」**中文\n",
    );
  });

  it("keeps a span around code when a word is typed against it", async () => {
    const gluing = (word: string) => (view: EditorView) => {
      const at = find(view.state.doc, word);
      const space = word.startsWith(" ") ? at : at + word.length - 1;
      view.dispatch(view.state.tr.delete(space, space + 1));
    };
    // The space between the span and the word deleted.
    expect(await savedAfter("x **`b`** y\n", gluing(" y"))).toBe(
      "x **`b`**&#x79;\n",
    );
    expect(await savedAfter("x ~~`b`~~ y\n", gluing(" y"))).toBe(
      "x ~~`b`~~&#x79;\n",
    );
    expect(await savedAfter("x ~~(b)~~ y\n", gluing("x "))).toBe(
      "&#x78;~~(b)~~ y\n",
    );
    expect(await savedAfter("x ==`b`== y\n", gluing(" y"))).toBe(
      "x ==`b`==&#x79;\n",
    );
    expect(await savedAfter("x ~`b`~ y\n", gluing("x "))).toBe(
      "&#x78;~`b`~ y\n",
    );
    // CJK text is read by remark-cjk-friendly as it stands.
    expect(await savedAfter("中文 ~~`代码`~~ 中文\n", gluing(" 中文"))).toBe(
      "中文 ~~`代码`~~中文\n",
    );
    for (const saved of ["x ~~`b`~~&#x79;\n", "&#x78;~~(b)~~ y\n"])
      expect(await roundTrip(saved)).toBe(saved);
  });

  it("closes a span nested in one of its kind before text glued to it", async () => {
    const atEnd = (typed: string) => (view: EditorView) =>
      view.dispatch(
        view.state.tr.insertText(typed, view.state.doc.content.size - 1),
      );
    expect(await savedAfter("*foo *bar**\n", atEnd("Pasted"))).toBe(
      "*foo _bar_*&#x50;asted\n",
    );
    expect(await savedAfter("**foo **bar****\n", atEnd("Pasted"))).toBe(
      "**foo __bar__**&#x50;asted\n",
    );
    expect(await savedAfter("*x *!`c`**\n", atEnd("."))).toBe("*x _!`c`_*.\n");
    // With a space after, the delimiters close as they are.
    expect(await savedAfter("*foo *bar**\n", atEnd(" end"))).toBe(
      "*foo *bar** end\n",
    );
  });

  it("writes a bare www. link with text right after it as a link", async () => {
    // Unlinked text against the link, as a paste puts it there.
    const glued = (view: EditorView) => {
      const { tr, schema, doc } = view.state;
      view.dispatch(tr.insert(find(doc, " end"), schema.text("Next")));
    };
    expect(await savedAfter("www.example.org end\n", glued)).toBe(
      "[www.example.org](http://www.example.org)Next end\n",
    );
    expect(await roundTrip("www.example.org. end\n")).toBe(
      "www.example.org. end\n",
    );
    // Punctuation and then text: GFM takes the punctuation into the link.
    const after = (view: EditorView) => {
      const { tr, schema, doc } = view.state;
      view.dispatch(tr.insert(find(doc, ". end") + 1, schema.text("Next")));
    };
    expect(await savedAfter("www.example.org/a.b. end\n", after)).toBe(
      "[www.example.org/a.b](http://www.example.org/a.b).Next end\n",
    );
    // `<` ends the link, but before a letter it is written `\<`.
    expect(
      await savedAfter("www.example.org/he<lp end\n", deleting(" end")),
    ).toBe("[www.example.org/he](http://www.example.org/he)\\<lp\n");
  });

  it("keeps a heading's closing hashes in its text", async () => {
    expect(await savedAfter("### foo \\### b\n", deleting("b"))).toBe(
      "### foo ##\\# \n",
    );
  });

  it("writes line ends one at a time, and none at a paragraph's end", async () => {
    expect(await savedAfter("aaa\nbbb\nccc\n", deleting("bbb"))).toBe(
      "aaa\nccc\n",
    );
    expect(await savedAfter("aaa\nbbb\n", deleting("bbb"))).toBe("aaa\n");
    expect(await savedAfter("aaa\\\nbbb\n", deleting("bbb"))).toBe("aaa\n");
  });

  it("writes a pasted <br> at the end of a line as one break", async () => {
    const saved = await savedAfter("a\nb\n", (view) => {
      const { schema } = view.state;
      const br = schema.nodes.html.create(null, schema.text("<br>"));
      view.dispatch(
        view.state.tr
          .insert(find(view.state.doc, "a") + 1, br)
          .setMeta("uiEvent", "paste"),
      );
    });
    expect(saved).toBe("a\\\nb\n");
  });

  it("keeps a <br> typed by hand as written", async () => {
    const saved = await savedAfter("ab\n", (view) => {
      const { schema } = view.state;
      const br = schema.nodes.html.create(null, schema.text("<br>"));
      view.dispatch(view.state.tr.insert(find(view.state.doc, "a") + 1, br));
    });
    expect(saved).toBe("a<br>b\n");
  });

  it("writes hard breaks the way the document does", async () => {
    expect(await savedAfter("one  \ntwo\n\nx\n", typingAfter("two", "!"))).toBe(
      "one  \ntwo!\n\nx\n",
    );
    expect(await savedAfter("one\\\ntwo\n", typingAfter("two", "!"))).toBe(
      "one\\\ntwo!\n",
    );
  });

  it("pads table columns by their width on screen, CJK counted double", async () => {
    expect(
      await savedAfter(
        "| 名称 | b |\n| - | - |\n| x | y |\n",
        typingAfter("y", "!"),
      ),
    ).toBe("| 名称 | b  |\n| ---- | -- |\n| x    | y! |\n");
  });

  it("starts an item whose first line was emptied with its next block", async () => {
    expect(await savedAfter("- foo\n\n  bar\n", deleting("foo"))).toBe(
      "- bar\n",
    );
    expect(
      await savedAfter(
        "1.     indented code\n\n   paragraph\n",
        typingAfter("paragraph", "!"),
      ),
    ).toBe("1. ```\n   indented code\n   ```\n\n   paragraph!\n");
  });

  it("keeps a nested item whose only word was deleted an item", async () => {
    const saved = await savedAfter(
      "* PHP\n  * Symfony\n* Python\n",
      deleting("Symfony"),
    );
    expect(saved).toBe("* PHP\n  * &#x20;\n* Python\n");
    const editor = await createTestEditor(saved);
    editors.push(editor);
    const items = editor.action((ctx) => {
      let count = 0;
      ctx.get(editorViewCtx).state.doc.descendants((node) => {
        if (node.type.name === "list_item") count++;
      });
      return count;
    });
    expect(items).toBe(3);
  });

  it("writes a rule in a list item so it stays one", async () => {
    expect(await savedAfter("- Foo\n- * * *\n", typingAfter("Foo", "!"))).toBe(
      "- Foo!\n- ___\n",
    );
    expect(await savedAfter("- Foo\n\n  ***\n", typingAfter("Foo", "!"))).toBe(
      "- Foo!\n\n  ___\n",
    );
  });
});

describe("a file that opens with a rule", () => {
  it("reads its lists and quotes as lists and quotes", async () => {
    const editor = await createTestEditor(
      "---\n\n1. one\n\n- two\n\n> three\n",
    );
    editors.push(editor);
    const kinds = editor.action((ctx) => {
      const names: string[] = [];
      ctx
        .get(editorViewCtx)
        .state.doc.forEach((node) => names.push(node.type.name));
      return names;
    });
    expect(kinds).toEqual(["hr", "ordered_list", "bullet_list", "blockquote"]);
  });

  it("still reads closed front matter", async () => {
    expect(await roundTrip("---\ntitle: x\n---\n\n- a\n")).toBe(
      "---\ntitle: x\n---\n\n- a\n",
    );
  });
});
