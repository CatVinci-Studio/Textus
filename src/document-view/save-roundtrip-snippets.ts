import { random } from "./save-roundtrip";

// Test-only: the Markdown the CI round trip is made of, written for this
// suite so nothing third-party is committed.

/** One construct each, in the many ways files write them. */
export const CONSTRUCTS: readonly string[] = [
  // Headings
  "# Title",
  "Setext title\n============",
  "Setext subtitle\n---",
  "### Closed heading ###",
  "## Heading with `code` and *em*",
  "#### Heading ending in a hash \\#",
  // Paragraphs and inline style
  "Plain paragraph with several words in it.",
  "Some _em_ and __strong__ and ***both*** here.",
  "Some *em* and **strong** and ~~struck~~ and ==marked== text.",
  "A line\nwith a soft break\nand another.",
  "A hard break  \nwith two spaces, and one\\\nwith a backslash.",
  "Escapes: snake_case, 2 * 3, \\*not em\\*, a \\# and 1\\. item.",
  "Entities: &amp; &nbsp; &copy; &#35; and a < b > c.",
  "Inline `code`, ``code with ` tick``, and `a` `b` side by side.",
  "Text with `code`then text, and **bold**`code` right after.",
  "**bold**s and *em*ph glued to words.",
  "Code in spans: **a `b` c**, *`d`*, ***`e` f***, ~~`g`~~ and ==h `i`==.",
  "中文**加粗`代码`加粗**，**`代码`**紧贴中文。",
  "中文段落，包含**加粗**和*斜体*，以及`代码`。",
  "日本語の文章と**太字**、そして English words.",
  "Emoji 🎉 and an accented café, naïve façade.",
  "A tab\tinside a line.",
  // Links and images
  "A [link](https://example.com) and [one with title](https://example.com 'T').",
  "An autolink <https://example.com> and a bare https://example.com/path.",
  "Mail <user@example.com> and www.example.com bare.",
  "A [link with **bold** and `code` inside](https://example.com/x) here.",
  "[Tech [Episodes] Complete](https://example.com/p) (podcast)",
  "A reference [link][ref], a [collapsed][] and a [shortcut].\n\n[ref]: https://example.com/r\n[collapsed]: https://example.com/c\n[shortcut]: https://example.com/s 'Title'",
  '![An image](images/a.png) and ![titled](b.jpg "Title").',
  '<img src="c.png" width="200" alt="sized">',
  "[![badge](https://img.example.com/b.svg)](https://example.com)",
  "An empty link [](https://example.com/e) here.",
  // Obsidian
  "See [[Note]], [[Note|shown]] and [[Note#Heading]].",
  "#tag at the start, and #another in a line.",
  // Colour codes, drawn with swatches
  "Orange #ff8800, **bold #00ff00**, `#123456`, rgb(0 128 255) and #add.",
  "| Colour | Code |\n| --- | --- |\n| Blue | hsl(210 100% 50%) |\n| Red | #f00 |",
  "![[embedded.png]]",
  // Lists
  "- one\n- two\n- three",
  "* star\n* list",
  "+ plus\n+ list",
  "1. first\n2. second\n3. third",
  "1) paren\n2) list",
  "3. starts at three\n4. four",
  "- loose\n\n- list\n\n- items",
  "- parent\n  - child\n    - grandchild\n  - child two",
  "- [ ] task\n- [x] done\n- [ ] another",
  "-   wide\n-   indent\n\n    continued paragraph",
  "- item with code:\n\n  ```js\n  let x = 1;\n  ```",
  "1. item\n\n   > quoted in item",
  "- Foo\n- * * *",
  "-\n  item starting on the next line",
  "- first line\n\n  second paragraph of the item",
  // Quotes and alerts
  "> A quote\n> over two lines.",
  "> Nested\n>> deeper quote",
  "> [!NOTE]\n> An alert.",
  "> [!tip]- Folded callout\n> Body.",
  // Code
  "```\nplain fence\n```",
  '```js title="a.js" {1,3}\nconst a = 1;\n```',
  "~~~python\ndef f():\n    pass\n~~~",
  "    indented code\n    block",
  "````md\n```\nnested fence\n```\n````",
  // Maths
  "Inline $x^2$ and $$y_1$$ maths.",
  "$$\n\\int_0^1 f(x)\\,dx\n$$",
  "LaTeX \\(a+b\\) inline and display:\n\\[\nE = mc^2\n\\]",
  "Prices $5 and $6 are text.",
  "A citation [1] and \\[2\\] stay text.",
  // Tables
  "| a | b |\n|---|:-:|\n| 1 | 2 |",
  "| Left | Centre | Right |\n| :--- | :----: | ----: |\n| x    |   y    |     z |",
  "| cell with `code` | and **bold** |\n| --- | --- |\n| a<br>b | \\| pipe |",
  // Footnotes
  "A footnote[^1] reference.\n\n[^1]: The note.",
  // Rules and HTML
  "---",
  "***",
  "_ _ _",
  '<div align="center">\n  <b>HTML block</b>\n</div>',
  "<!-- a comment -->",
  "Inline <kbd>Ctrl</kbd> and <br> breaks<br/>here.",
  "<details>\n<summary>More</summary>\n\nHidden *markdown*.\n\n</details>",
  // Definitions and setext corner cases
  "[foo]: /url\nbar\n===",
  "Term\n: Pandoc definition",
];

/** Shapes that have broken the round trip, each as a document. */
export const REGRESSIONS: readonly string[] = [
  "- MAJOR 版本包括不兼容变更<br>\n  `1.0.0` → `2.0.0`\n- MINOR 版本<br>\n  `1.0.0` → `1.1.0`",
  "**[⬆ Back to Index](#index)**\n<br >\n\n<br >\n\nNext",
  "foo**bar**\n\n*foo**bar**baz*",
  "**foo *bar***\n\n*_foo_*\n\n____foo____",
  "foo\n    # bar\n\n> foo\n    - bar",
  "1.     indented code\n\n   paragraph\n\n       more code",
  "  - foo\n\n\tbar",
  "    one\n\npara\n\n    two",
  " -    one\n\n     two",
  "[link *foo **bar** `#`*](/uri)",
  '[*foo* bar]\n\n[*foo* bar]: /url "title"',
  "### foo ### b",
  "&#9;foo",
  "foo&#10;&#10;bar",
  "例如：`//cdn/a.js`变为`//cdn/b.js`",
  "梯度$\\mathbf{g}_t$的平方$\\mathbf{s}_t$",
  "- [The `match` Control Flow Construct](ch06-02-match.md)",
  "aaa\n             bbb\n                                       ccc",
  "| breaks | ends |\n| --- | --- |\n| a<br/>b<br />c | d<br> |\n| _i_ x<br><br>y | e<br><br> |",
];

/**
 * The documents the CI round trip opens, picked by a seeded generator so a
 * failure names a document that exists.
 */
export function snippetDocuments(count: number): [string, string][] {
  const docs: [string, string][] = [];
  CONSTRUCTS.forEach((construct, i) =>
    docs.push([`construct ${i}`, construct + "\n"]),
  );
  REGRESSIONS.forEach((doc, i) => docs.push([`regression ${i}`, doc + "\n"]));
  const rand = random(20261019);
  for (let i = 0; i < count; i++) {
    const size = 3 + Math.floor(rand() * 4);
    const parts = Array.from(
      { length: size },
      () => CONSTRUCTS[Math.floor(rand() * CONSTRUCTS.length)],
    );
    // Mostly one blank line between blocks, as files have them; sometimes
    // two, or none where that still reads as two blocks.
    const gap = () => (rand() < 0.15 ? "\n\n\n" : "\n\n");
    docs.push([
      `mix ${i}`,
      parts.reduce((doc, part) => doc + gap() + part) + "\n",
    ]);
  }
  return docs;
}
