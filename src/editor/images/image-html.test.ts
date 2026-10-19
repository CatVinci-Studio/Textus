// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  escapeAttribute,
  imageMarkdownHtml,
  imageWidthOf,
  parseImageTag,
  readImagePresentation,
  withImageWidth,
  type ImageAttrs,
} from "./image-html";

const image = (attrs: Partial<ImageAttrs>): ImageAttrs => ({
  src: "a.png",
  alt: "",
  title: "",
  width: "",
  html: "",
  ...attrs,
});

describe("reading an <img> tag", () => {
  it("reads its picture, alt, title and width", () => {
    expect(
      parseImageTag(
        '<img src="assets/a.png" alt="图" title="Cap" width="40%">',
      ),
    ).toEqual({ src: "assets/a.png", alt: "图", title: "Cap", width: "40%" });
  });

  it("reads single-quoted, bare and self-closed attributes", () => {
    expect(parseImageTag("<img src='a b.png' width=320 />")).toEqual({
      src: "a b.png",
      alt: "",
      title: "",
      width: "320",
    });
  });

  it("decodes character references in its values", () => {
    expect(
      parseImageTag('<img src="a.png?x=1&amp;y=2" alt="&quot;Q&quot; &lt;3">'),
    ).toMatchObject({ src: "a.png?x=1&y=2", alt: '"Q" <3' });
  });

  it("reads Typora's zoom style, which it doesn't show", () => {
    expect(
      parseImageTag('<img src="a.png" alt="x" style="zoom:50%;" />'),
    ).toEqual({ src: "a.png", alt: "x", title: "", width: "" });
  });

  it.each([
    ["no src", '<img alt="x" width="50%">'],
    ["an attribute it doesn't show", '<img src="a.png" height="100">'],
    ["a width that isn't a size", '<img src="a.png" width="wide">'],
    ["a style the policy draws", '<img src="a.png" style="color: red">'],
    ["more than the tag", '<img src="a.png"> and text'],
    ["two tags", '<img src="a.png"><img src="b.png">'],
    ["another tag", '<span src="a.png">'],
  ])("leaves a tag with %s to raw HTML", (_name, tag) => {
    expect(parseImageTag(tag)).toBeNull();
  });
});

describe("saving an image", () => {
  it("writes a sized image as <img>, its title kept", () => {
    expect(
      imageMarkdownHtml(
        image({ src: "assets/a.png", alt: "alt", width: "50%" }),
      ),
    ).toBe('<img src="assets/a.png" alt="alt" width="50%">');
    expect(
      imageMarkdownHtml(image({ alt: "图", title: "Cap", width: "30%" })),
    ).toBe('<img src="a.png" alt="图" title="Cap" width="30%">');
  });

  it("writes an image without a width as Markdown", () => {
    expect(imageMarkdownHtml(image({ alt: "x", title: "Cap" }))).toBeNull();
  });

  it("writes a tag nobody changed byte for byte", () => {
    const html = "<img width=320 src='a.png' style=\"zoom:50%;\" />";
    expect(imageMarkdownHtml(image({ width: "320", html }))).toBe(html);
  });

  it("writes a changed tag afresh", () => {
    const html = '<img src="a.png" alt="x" width="40%" style="zoom:50%;" />';
    expect(imageMarkdownHtml(image({ alt: "x", width: "70%", html }))).toBe(
      '<img src="a.png" alt="x" width="70%">',
    );
    // Auto: back to Markdown.
    expect(imageMarkdownHtml(image({ alt: "x", html }))).toBeNull();
  });

  it("escapes what would end the attribute or the tag", () => {
    expect(escapeAttribute('a "b" & <c>\nd')).toBe(
      "a &quot;b&quot; &amp; &lt;c&gt;&#10;d",
    );
    const attrs = image({
      src: "my pic.png?a=1&b=2",
      alt: 'say "hi" <b>',
      width: "50%",
    });
    const html = imageMarkdownHtml(attrs)!;
    expect(html).toBe(
      '<img src="my pic.png?a=1&amp;b=2" alt="say &quot;hi&quot; &lt;b&gt;" width="50%">',
    );
    expect(parseImageTag(html)).toEqual({
      src: attrs.src,
      alt: attrs.alt,
      title: "",
      width: "50%",
    });
  });

  it("keeps a src as written, percent-escapes and all", () => {
    expect(
      imageMarkdownHtml(image({ src: "assets/my%20pic.png", width: "30%" })),
    ).toBe('<img src="assets/my%20pic.png" width="30%">');
  });
});

describe("a width an older Textus kept in the title", () => {
  it("reads it without showing it as the caption", () => {
    expect(readImagePresentation("Product shot {textus-width=70%}")).toEqual({
      title: "Product shot",
      widthPercent: 70,
    });
    expect(readImagePresentation("Shot {levis-width=40%}")).toEqual({
      title: "Shot",
      widthPercent: 40,
    });
    expect(imageWidthOf(image({ title: "{textus-width=30%}" }))).toBe("30%");
  });

  it("gives way to the image's own width", () => {
    expect(
      imageWidthOf(image({ title: "{textus-width=30%}", width: "320" })),
    ).toBe("320");
    expect(imageWidthOf(image({}))).toBeNull();
  });

  it("comes out of the title when the width changes, the caption kept", () => {
    const old = image({ alt: "x", title: "Product shot {textus-width=50%}" });
    const sized = withImageWidth(old, 70) as ImageAttrs;
    expect(sized).toMatchObject({ title: "Product shot", width: "70%" });
    expect(imageMarkdownHtml(sized)).toBe(
      '<img src="a.png" alt="x" title="Product shot" width="70%">',
    );
    const auto = withImageWidth(
      image({ title: "{textus-width=50%}" }),
      null,
    ) as ImageAttrs;
    expect(auto).toMatchObject({ title: "", width: "" });
    expect(imageMarkdownHtml(auto)).toBeNull();
  });
});
