import { describe, expect, it } from "vitest";
import { TYPED_LINK } from "./link-input-rule";

describe("a typed link", () => {
  it("is found as its closing parenthesis goes in", () => {
    const match = TYPED_LINK.exec("See [Gutenberg](https://gutenberg.org)");
    expect(match?.[1]).toBe("Gutenberg");
    expect(match?.[2]).toBe("https://gutenberg.org");
    expect(
      TYPED_LINK.exec("链接：[维基文库](https://zh.wikisource.org)")?.[1],
    ).toBe("维基文库");
  });

  it("is not an image, nor text with an inline node in it", () => {
    expect(TYPED_LINK.test("![alt](a.png)")).toBe(false);
    expect(TYPED_LINK.test("[a \ufffc b](u)")).toBe(false);
  });

  it("wants a URL without spaces, and the link ended", () => {
    expect(TYPED_LINK.test("[a](not a url)")).toBe(false);
    expect(TYPED_LINK.test("[a](u) and on")).toBe(false);
    expect(TYPED_LINK.test("[](u)")).toBe(false);
  });
});
