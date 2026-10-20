import { describe, expect, it } from "vitest";
import { TYPED_FOOTNOTE, TYPED_TAG } from "./source-input-rules";

describe("TYPED_TAG", () => {
  it("matches a tag just closed", () => {
    for (const tag of ["<b>", "</b>", "<br>", "<br/>", '<span class="x">'])
      expect(TYPED_TAG.exec(`text ${tag}`)?.[0]).toBe(tag);
  });

  it("leaves comparisons and arrows alone", () => {
    for (const text of ["a < b > c", "x -> y", "<>", "1<2>"])
      expect(TYPED_TAG.test(text)).toBe(false);
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
