import { describe, expect, it } from "vitest";
import { pastesImage } from "./image-notice-plugin";

function clipboard(
  items: { kind: string; type: string }[],
  data: Record<string, string> = {},
) {
  return {
    items,
    files: [] as unknown as FileList,
    getData: (format: string) => data[format] ?? "",
  };
}

describe("a paste in the playground", () => {
  it("is an image when it carries a bitmap or an image file", () => {
    expect(
      pastesImage(clipboard([{ kind: "file", type: "image/png" }]), null),
    ).toBe(true);
  });

  it("is an image when it is image files copied in a file manager", () => {
    const copied = clipboard([], { "text/uri-list": "file:///home/a/b.png" });
    expect(pastesImage(copied, null)).toBe(true);
  });

  it("is text otherwise, links to images included", () => {
    const text = clipboard([{ kind: "string", type: "text/plain" }], {
      "text/plain": "https://example.com/cat.png",
    });
    expect(pastesImage(text, null)).toBe(false);
    const pdf = clipboard([], { "text/uri-list": "file:///home/a/b.pdf" });
    expect(pastesImage(pdf, null)).toBe(false);
  });
});
