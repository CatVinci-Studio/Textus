// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { toPandocMarkdown } from "./pandoc-markdown";

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
    expect(toPandocMarkdown('![x](a.png "A caption {levis-width=50%}")')).toBe(
      '![x](a.png "A caption"){width=50%}',
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
    expect(toPandocMarkdown("> [!WARNING]\n> 小心", labels)).toBe(
      "> **警告**\n> 小心",
    );
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
});
