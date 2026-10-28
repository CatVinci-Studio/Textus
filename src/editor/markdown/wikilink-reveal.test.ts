import { describe, expect, it } from "vitest";
import { hiddenParts } from "./wikilink-reveal";

describe("what a wikilink hides while the caret is away", () => {
  it("is its brackets, and the note's name before an alias", () => {
    expect(hiddenParts("[[Note]]")).toEqual([
      [0, 2],
      [6, 8],
    ]);
    expect(hiddenParts("[[Note|shown]]")).toEqual([
      [0, 7],
      [12, 14],
    ]);
  });

  it("is nothing for a link being typed", () => {
    expect(hiddenParts("[[Note")).toBeNull();
    expect(hiddenParts("[[]]")).toBeNull();
  });
});
