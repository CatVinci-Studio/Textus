import { describe, expect, it } from "vitest";
import { TYPED_IMAGE, TYPED_LINK } from "./link-input-rule";

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

describe("a typed image", () => {
  it("is found as its closing parenthesis goes in", () => {
    const match = TYPED_IMAGE.exec("看 ![美女](https://i.pinimg.com/a.jpg)");
    expect(match?.[1]).toBe("美女");
    expect(match?.[2]).toBe("https://i.pinimg.com/a.jpg");
    expect(TYPED_IMAGE.exec("![](assets/a.png)")?.[2]).toBe("assets/a.png");
  });

  it("is not a link, an Obsidian embed, nor text with an inline node", () => {
    expect(TYPED_IMAGE.test("[alt](a.png)")).toBe(false);
    expect(TYPED_IMAGE.test("![[a.png]]")).toBe(false);
    expect(TYPED_IMAGE.test("![a \ufffc b](a.png)")).toBe(false);
  });

  it("wants a source without spaces, and the image ended", () => {
    expect(TYPED_IMAGE.test("![a](not a src)")).toBe(false);
    expect(TYPED_IMAGE.test("![a](a.png) and on")).toBe(false);
  });
});
