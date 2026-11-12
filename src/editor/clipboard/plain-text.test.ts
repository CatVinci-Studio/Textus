// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { createTestEditor } from "../editor-test-kit";
import { definitionsIn } from "../markdown/link-reveal";
import { plainTextOf } from "./plain-text";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** The plain text a copy of the whole document gives. */
async function plain(markdown: string): Promise<string> {
  editor = await createTestEditor(markdown);
  return plainTextOf(editor.ctx.get(editorViewCtx).state.doc.content);
}

describe("plainTextOf", () => {
  it("keeps a link's address after its text, once", async () => {
    expect(await plain("See [Textus](https://textus.md) now.")).toBe(
      "See Textus (https://textus.md) now.",
    );
    expect(
      await plain("[https://x.org/a](https://x.org/a) and <https://x.org/b>"),
    ).toBe("https://x.org/a and https://x.org/b");
  });

  it("reads a link's label as text, a reference's URL from its definition", async () => {
    expect(await plain("See [the **docs**](https://x.org) here.")).toBe(
      "See the docs (https://x.org) here.",
    );
    const t = await createTestEditor("A [a][r] b\n\n[r]: https://r.org");
    editor = t;
    const { doc } = t.ctx.get(editorViewCtx).state;
    expect(plainTextOf(doc.firstChild!.content, () => definitionsIn(doc))).toBe(
      "A a (https://r.org) b",
    );
  });

  it("drops the Markdown marks", async () => {
    expect(await plain("# Title\n\nA **bold** and *soft* `code` word.")).toBe(
      "Title\n\nA bold and soft code word.",
    );
  });

  it("keeps list markers and nesting, tasks as boxes", async () => {
    expect(await plain("- one\n  - inner\n- two\n\n3. third\n4. fourth")).toBe(
      "• one\n  • inner\n• two\n\n3. third\n4. fourth",
    );
    expect(await plain("- [ ] open\n- [x] done")).toBe("☐ open\n☑ done");
  });

  it("writes a table a row a line, cells tab-separated", async () => {
    expect(await plain("| a | b |\n|---|---|\n| 1 | 2 |")).toBe("a\tb\n1\t2");
  });

  it("keeps code and quotes as text, leaves HTML comments out", async () => {
    expect(
      await plain("> quoted\n\n```\nlet x = 1;\n```\n\n<!-- note -->\n\nend"),
    ).toBe("quoted\n\nlet x = 1;\n\nend");
  });

  it("gives an image's alt text and a formula's source", async () => {
    expect(await plain("A ![diagram](a.png) and $x^2$ here.")).toBe(
      "A diagram and x^2 here.",
    );
  });
});
