// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { createTestEditor } from "../editor-test-kit";
import { htmlSource } from "./html-source";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** The HTML source a copy of the whole document gives. */
async function html(markdown: string): Promise<string> {
  editor = await createTestEditor(markdown);
  const view = editor.ctx.get(editorViewCtx);
  const { dom } = view.serializeForClipboard(view.state.doc.slice(0));
  return htmlSource(dom);
}

describe("htmlSource", () => {
  it("writes a block a line, without the editor's attributes", async () => {
    expect(
      await html(
        "## Chapter\n\nA **bold** and *soft* [link](https://textus.md).\n\n- one\n- two",
      ),
    ).toBe(
      [
        "<h2>Chapter</h2>",
        '<p>A <strong>bold</strong> and <em>soft</em> <a href="https://textus.md">link</a>.</p>',
        "<ul>",
        "<li>one</li>",
        "<li>two</li>",
        "</ul>",
      ].join("\n"),
    );
  });

  it("keeps a code block's lines and its language", async () => {
    expect(await html("```python\nif x:\n    print(1 < 2)\n```")).toBe(
      '<pre><code class="language-python">if x:\n    print(1 &lt; 2)</code></pre>',
    );
  });

  it("writes a table's rows a line, an ordered list's start and a picture", async () => {
    const out = await html(
      "| a | b |\n|---|---|\n| 1 | 2 |\n\n3. three\n4. four\n\n![cat](pics/cat.png)",
    );
    expect(out).toContain("<tr>\n<th>a</th>\n<th>b</th>\n</tr>");
    expect(out).toContain('<ol start="3">');
    expect(out).toContain('<img src="pics/cat.png" alt="cat">');
  });
});
