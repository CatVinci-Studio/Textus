import { describe, expect, it } from "vitest";
import { parseHeadings } from "./outline-parse";

const texts = (md: string) => parseHeadings(md).map((h) => h.text);

describe("parseHeadings", () => {
  it("skips headings inside fenced code", () => {
    expect(texts("# A\n```sh\n# comment\n```\n## B")).toEqual(["A", "B"]);
  });

  it("finds headings after a fence opened in a list item (#477)", () => {
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
});
