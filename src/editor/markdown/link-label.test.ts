// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { labelMarkdown } from "./link-label";

const picture = (src: string) => {
  const img = document.createElement("img");
  img.setAttribute("src", src);
  img.setAttribute("alt", "a [b]");
  return img;
};

describe("a pasted link's picture", () => {
  it("puts its src in <…> when a space, parenthesis or angle bracket would end it", () => {
    expect(labelMarkdown(picture("a.png"))).toBe("![a \\[b\\]](a.png)");
    expect(labelMarkdown(picture("my pic.png"))).toBe(
      "![a \\[b\\]](<my pic.png>)",
    );
    expect(labelMarkdown(picture("pic (1).png"))).toBe(
      "![a \\[b\\]](<pic (1).png>)",
    );
    expect(labelMarkdown(picture("a<b>.png"))).toBe("![a \\[b\\]](<a<b>.png>)");
  });
});
