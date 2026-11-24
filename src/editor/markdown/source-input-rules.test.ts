import { describe, expect, it } from "vitest";
import { TYPED_FOOTNOTE, TYPED_TAG } from "./source-input-rules";
import { unsafePattern } from "../code/pattern-safety";

/** The tag the rule takes at the end of `text`, as its handler does. */
function typedTag(text: string): string | null {
  const match = TYPED_TAG.exec(text);
  return match && !match[1] ? match[2] : null;
}

describe("TYPED_TAG", () => {
  it("matches a tag just closed", () => {
    for (const tag of ["<b>", "</b>", "<br>", "<br/>", '<span class="x">'])
      expect(typedTag(`text ${tag}`)).toBe(tag);
  });

  it("leaves comparisons, arrows and a link's <destination> alone", () => {
    for (const text of ["a < b > c", "x -> y", "<>", "1<2>", "[a](<b>"])
      expect(typedTag(text)).toBeNull();
  });

  it("has no lookbehind, which older iOS WebKit can't compile", () => {
    expect(unsafePattern(TYPED_TAG.source)).not.toBe("a lookbehind");
  });
});

describe("TYPED_FOOTNOTE", () => {
  it("matches a reference just closed", () => {
    expect(TYPED_FOOTNOTE.exec("see[^1]")?.[1]).toBe("1");
    expect(TYPED_FOOTNOTE.exec("see [^note]")?.[1]).toBe("note");
  });

  it("leaves brackets that aren't one alone", () => {
    for (const text of ["[^]", "[^a b]", "[x]", "[^1"])
      expect(TYPED_FOOTNOTE.test(text)).toBe(false);
  });
});
