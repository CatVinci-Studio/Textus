import { describe, expect, it } from "vitest";
import { parseHeadings, sourceAnchors, headingLabel } from "./outline-parse";

const texts = (md: string) => parseHeadings(md).map((h) => h.text);

describe("parseHeadings", () => {
  it("skips headings inside fenced code", () => {
    expect(texts("# A\n```sh\n# comment\n```\n## B")).toEqual(["A", "B"]);
    // Nor a comment in the front matter's YAML.
    expect(texts("---\n# draft\ntitle: T\n---\n# A")).toEqual(["A"]);
  });

  it("counts every heading the editor does: indented, empty and setext", () => {
    expect(texts("# A\n  ## B\n\n##\n\nC\n===\n\nD\n---\n\n# E")).toEqual([
      "A",
      "B",
      "",
      "C",
      "D",
      "E",
    ]);
    // A rule after a blank line is a rule, not a heading.
    expect(texts("A\n\n---\n# B")).toEqual(["B"]);
  });

  it("finds headings after a fence opened in a list item", () => {
    const md =
      "### Lists\n\n1. Red\n2. ```\n   Green\n   ```\n3. Blue\n\n### Task List";
    expect(texts(md)).toEqual(["Lists", "Task List"]);
  });

  it("handles fences inside blockquotes", () => {
    expect(texts("> ```\n> # not a heading\n> ```\n# After")).toEqual([
      "After",
    ]);
  });

  it("closes a fence only on the same character, at least as long", () => {
    const md = "````\n```\n# inside\n~~~\n````\n# After";
    expect(texts(md)).toEqual(["After"]);
  });

  it("does not take inline code with backticks for a fence", () => {
    expect(texts("```a``` b\n# After")).toEqual(["After"]);
  });

  it("keeps a fence open when the would-be closer has an info string", () => {
    expect(texts("```\n``` js\n# inside\n```\n# After")).toEqual(["After"]);
  });

  it("gives the anchors the editor gives, math kept", () => {
    expect(
      sourceAnchors(["Energy $E=mc^2$", "`Code` *now*", "Energy $E=mc^2$"]),
    ).toEqual(["energy-emc2", "code-now", "energy-emc2-1"]);
  });

  it("keeps underscores inside words, code and maths", () => {
    expect(headingLabel("get_user_name and _this_")).toBe(
      "get_user_name and this",
    );
    expect(headingLabel("Use `a_b_c` here")).toBe("Use a_b_c here");
    expect(headingLabel("Sum $a_1 + b_2$")).toBe("Sum $a_1 + b_2$");
    expect(sourceAnchors(["snake_case_name"])).toEqual(["snake_case_name"]);
  });
});
