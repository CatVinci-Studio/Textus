// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { toPandocMarkdown } from "./pandoc-markdown";

const alertLabels = {
  NOTE: "Note",
  TIP: "Tip",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
};

describe("toPandocMarkdown", () => {
  it("turns highlights into marked spans", () => {
    expect(toPandocMarkdown("一段==高亮==文字，==two words== here")).toBe(
      "一段[高亮]{.mark}文字，[two words]{.mark} here",
    );
  });

  it("leaves equals signs that are not a highlight", () => {
    expect(toPandocMarkdown("a == b and c ==d")).toBe("a == b and c ==d");
  });

  it("moves an image's width from its title to an attribute", () => {
    expect(toPandocMarkdown('![图](assets/a.png "{textus-width=30%}")')).toBe(
      "![图](assets/a.png){width=30%}",
    );
    expect(toPandocMarkdown('![x](a.png "A caption {textus-width=50%}")')).toBe(
      '![x](a.png "A caption"){width=50%}',
    );
    // A turn has no pandoc form: the caption reads without it.
    expect(toPandocMarkdown('![x](a.png "Turned {textus-rotate=90}")')).toBe(
      '![x](a.png "Turned")',
    );
    expect(
      toPandocMarkdown('![x](a.png "{levis-width=40% levis-rotate=180}")'),
    ).toBe("![x](a.png){width=40%}");
    expect(toPandocMarkdown("![cat|300](a.png)")).toBe(
      "![cat](a.png){width=300px}",
    );
  });

  it("turns a sized <img> into an image with a width attribute", () => {
    expect(
      toPandocMarkdown('<img src="assets/a.png" alt="图" width="50%">'),
    ).toBe("![图](assets/a.png){width=50%}");
    expect(
      toPandocMarkdown(
        'See <img src="my pic.png" alt="a [b]" title="say &quot;hi&quot;" width="320"> here',
      ),
    ).toBe('See ![a \\[b\\]](<my pic.png> "say \\"hi\\""){width=320px} here');
    expect(toPandocMarkdown('<img src="a.png" style="zoom:50%;" />')).toBe(
      "![](a.png)",
    );
  });

  it("leaves an <img> an image node doesn't carry as HTML", () => {
    const tag = '<img src="a.png" height="100">';
    expect(toPandocMarkdown(tag)).toBe(tag);
    expect(toPandocMarkdown('`<img src="a.png" width="5">`')).toBe(
      '`<img src="a.png" width="5">`',
    );
  });

  it("keeps images without a width as they are", () => {
    expect(toPandocMarkdown('![x](a.png "title")')).toBe('![x](a.png "title")');
  });

  it("titles an alert with the editor's label", () => {
    const labels = {
      NOTE: "备注",
      TIP: "提示",
      IMPORTANT: "重要",
      WARNING: "警告",
      CAUTION: "注意",
    };
    expect(
      toPandocMarkdown("> [!WARNING]\n> 小心", { alertLabels: labels }),
    ).toBe("> **警告**\n>\n> 小心");
    expect(toPandocMarkdown("> [!WARNING]\n> 小心")).toBe(
      "> [!WARNING]\n> 小心",
    );
  });

  it("does not touch code", () => {
    const md = [
      "`==not==` but ==yes==",
      "```js",
      "a ==b== c",
      "```",
      "~~~~",
      "```",
      "==still code==",
      "~~~~",
      "==after==",
    ].join("\n");
    expect(toPandocMarkdown(md)).toBe(
      [
        "`==not==` but [yes]{.mark}",
        "```js",
        "a ==b== c",
        "```",
        "~~~~",
        "```",
        "==still code==",
        "~~~~",
        "[after]{.mark}",
      ].join("\n"),
    );
  });

  it("reads callouts by the editor's rule: titles, folds, any type, nesting", () => {
    const md = [
      "> [!faq]- Why so?",
      "> Because.",
      "",
      "> [!tip]",
      "> > [!my-type]",
      "> > inner",
      "",
      "> text",
      "> [!note] not a callout here",
      "",
      "> [!note]x",
    ].join("\n");
    expect(toPandocMarkdown(md, { alertLabels })).toBe(
      [
        "> **Why so?**",
        ">",
        "> Because.",
        "",
        "> **Tip**",
        ">",
        "> > **My-type**",
        "> >",
        "> > inner",
        "",
        "> text",
        "> [!note] not a callout here",
        "",
        "> [!note]x",
      ].join("\n"),
    );
  });

  it("leaves %%comments%% out, as the editor hides them", () => {
    expect(toPandocMarkdown("a %%secret%% b")).toBe("a  b");
    expect(toPandocMarkdown("one\n%%whole line%%\ntwo")).toBe("one\ntwo");
    expect(toPandocMarkdown("start %%runs\non%% end")).toBe("start  end");
    expect(toPandocMarkdown("> q %%x\n> y%% z")).toBe("> q  z");
    // Not across paragraphs, list items or code, as in the editor.
    expect(toPandocMarkdown("a %%x\n\nb%% c")).toBe("a %%x\n\nb%% c");
    expect(toPandocMarkdown("- a %%x\n- b%%")).toBe("- a %%x\n- b%%");
    expect(toPandocMarkdown("`%%code%%` and $a%%b%%$")).toBe(
      "`%%code%%` and $a%%b%%$",
    );
    expect(toPandocMarkdown("```\n%%kept%%\n```")).toBe("```\n%%kept%%\n```");
  });

  it("writes the editor's subscript, superscript and one-tilde strikethrough", () => {
    expect(toPandocMarkdown("H~2~O, x^2^, ~gone~ and ~~old~~")).toBe(
      "H[2]{.textus-sub}O, x[2]{.textus-sup}, ~~gone~~ and ~~old~~",
    );
    expect(
      toPandocMarkdown("a ~b~ but ~a b~ and 2^10 and [^1] and ^[note]"),
    ).toBe("a ~~b~~ but ~~a b~~ and 2^10 and [^1] and ^[note]");
    expect(
      toPandocMarkdown("$a~b~c^2^$ `x~y~` [l](https://x.org/~a/~b) \\~n~"),
    ).toBe("$a~b~c^2^$ `x~y~` [l](https://x.org/~a/~b) \\~n~");
  });

  it("writes a wikilink as its shown text, linked where it leads", () => {
    const noteLinks = new Map([
      ["[[Plan|the plan]]", { href: "Plan%20A.md" }],
      ["[[Missing]]", null],
    ]);
    expect(
      toPandocMarkdown(
        "See [[Plan|the plan]], [[Missing]] and [[Note#Part]].",
        {
          noteLinks,
        },
      ),
    ).toBe("See [the plan](<Plan%20A.md>), Missing and Note\\#Part.");
    expect(toPandocMarkdown("| [[A\\|b_c]] |")).toBe("| b\\_c |");
  });

  it("puts an embedded picture in, sized, and links an embedded note", () => {
    const noteLinks = new Map([
      ["![[pic.png|300]]", { image: "/v/assets/pic.png", width: 300, alt: "" }],
      ["![[Note]]", { href: "Note.md" }],
    ]);
    expect(
      toPandocMarkdown("![[pic.png|300]] ![[Note]] ![[gone.png]]", {
        noteLinks,
      }),
    ).toBe(
      "![](</v/assets/pic.png>){width=300px} [Note](<Note.md>) gone\\.png",
    );
  });

  it("hands citations to citeproc only with a bibliography", () => {
    const md = "As [@doe99, p. 3] and [see @a; @b] say; mail [x a@b.c].";
    expect(toPandocMarkdown(md)).toBe(md);
    expect(toPandocMarkdown(md, { citations: true })).toBe(
      "As `[@doe99, p. 3]`{=textuscite} and `[see @a; @b]`{=textuscite} say; mail [x a@b.c].",
    );
  });
});
