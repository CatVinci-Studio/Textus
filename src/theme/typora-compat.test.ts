import { describe, expect, it } from "vitest";
import { adaptTyporaCss, namedSystemFonts } from "./typora-compat";

describe("adaptTyporaCss", () => {
  it("maps thead selectors onto the header row", () => {
    expect(adaptTyporaCss("#write thead th { color: red }")).toBe(
      "#write tr[data-is-header] th { color: red }",
    );
    expect(adaptTyporaCss("table thead > tr { x: y }")).toBe(
      "table tr[data-is-header] { x: y }",
    );
    expect(adaptTyporaCss("thead tr th, thead { x: y }")).toBe(
      "tr[data-is-header] th, tr[data-is-header] { x: y }",
    );
  });

  it("leaves unrelated selectors alone", () => {
    const css = "#write .theader, tbody tr:nth-child(2n) { x: y }";
    expect(adaptTyporaCss(css)).toBe(css);
  });

  it("maps CodeMirror token rules onto the Prism tokens of a code block", () => {
    expect(
      adaptTyporaCss(
        ".cm-s-inner .cm-keyword { a: b }\n.cm-s-inner span.cm-variable-2, .cm-s-inner .cm-comment { c: d }\n.cm-s-inner.CodeMirror { e: f }",
      ),
    ).toBe(
      ":where(.md-fences pre) .token.keyword { a: b }\n" +
        ":where(.md-fences pre) span.token.parameter, :where(.md-fences pre) .token:is(.comment, .prolog, .doctype) { c: d }\n" +
        ":where(.md-fences pre):where(.md-fences pre) { e: f }",
    );
  });

  it("leaves CodeMirror classes it has no counterpart for alone", () => {
    const css =
      ".cm-s-inner .cm-error, .cm-constructor, .CodeMirror-gutters, .cm-s-typora-default { x: y }";
    expect(adaptTyporaCss(css)).toBe(
      ":where(.md-fences pre) .cm-error, .cm-constructor, .CodeMirror-gutters, .cm-s-typora-default { x: y }",
    );
  });

  it("maps task, front matter, image and fence classes onto ours", () => {
    expect(
      adaptTyporaCss(
        "#write li.md-task-list-item.task-list-done, .task-list-not-done { a: b }\n" +
          "#write pre.md-meta-block, .md-image > img, pre.md-fences { c: d }",
      ),
    ).toBe(
      '#write li[data-item-type="task"][data-checked="true"], [data-checked="false"] { a: b }\n' +
        "#write .frontmatter-block, .image-view > img, .md-fences { c: d }",
    );
  });

  it("gives Typora's code font and selection variables the rules Typora's base has", () => {
    const css =
      ":root { --monospace: Menlo; --select-text-bg-color: #345; --select-text-font-color: #fff; }";
    expect(adaptTyporaCss(css)).toBe(
      css +
        "\n#write { --font-mono: var(--monospace); }\n" +
        "#write ::selection { background-color: var(--select-text-bg-color); }\n" +
        "#write ::selection { color: var(--select-text-font-color); }\n",
    );
  });

  it("adds no rule for a variable the theme only reads or doesn't set", () => {
    const css =
      ":root { --font-monospace: Menlo } code { font-family: var(--monospace) }";
    expect(adaptTyporaCss(css)).toBe(css);
  });
});

describe("namedSystemFonts", () => {
  it("names the system faces a theme asks for by their generic families", () => {
    expect(
      namedSystemFonts(
        '#write { font-family: -apple-system, "PingFang SC", sans-serif; }\n' +
          "code { font: 14px ui-monospace, Menlo }\nh1 { font-family: ui-serif }",
      ),
    ).toBe(
      '#write { font-family: "SF Pro Text", "PingFang SC", sans-serif; }\n' +
        'code { font: 14px "SF Mono", Menlo }\nh1 { font-family: "New York" }',
    );
  });

  it("leaves names that only contain one alone", () => {
    const css = ".system-ui-note { --ui-serif-size: 2px; }";
    expect(namedSystemFonts(css)).toBe(css);
  });
});
