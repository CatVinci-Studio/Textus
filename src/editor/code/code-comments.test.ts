import { describe, expect, it } from "vitest";
import { commentRanges } from "./code-comments";

/** The comments commentRanges finds, as written. */
const comments = (text: string, language: string | null) =>
  commentRanges(text, language).map(([from, to]) => text.slice(from, to));

describe("commentRanges", () => {
  it("finds comments by the highlighter's tokens", () => {
    expect(comments("a { color: #333; } /* see #234 */", "css")).toEqual([
      "/* see #234 */",
    ]);
    expect(
      comments('const c = "#333"; // see #234\nlet d = 1;', "javascript"),
    ).toEqual(["// see #234"]);
    expect(comments("x = '#333'  # see #234", "python")).toEqual([
      "# see #234",
    ]);
  });

  it("finds the common forms in a language it doesn't know", () => {
    expect(
      comments(
        "fill #333 // see #234\n# see #235\n-- see #236\n/* #237 */ <!-- #238 -->",
        null,
      ),
    ).toEqual([
      "// see #234",
      "# see #235",
      "-- see #236",
      "/* #237 */",
      "<!-- #238 -->",
    ]);
  });

  it("doesn't take a colour for a comment", () => {
    expect(comments("color: #333;\n#fff", null)).toEqual([]);
    expect(comments("a { color: #333; }", "css")).toEqual([]);
  });
});
