import { $remark } from "@milkdown/kit/utils";
import type { Attrs } from "@milkdown/kit/prose/model";
import { escapeHtml } from "../../utils/html";
import { sanitizeDimension, sanitizeStyle } from "../html/html-policy";

/**
 * A sized image is written as HTML - `<img src="a.png" alt="x" width="50%">`
 * - the one way to give a picture a width that GitHub, VS Code, Typora and
 * Obsidian all show. Textus 1.1.0 and older kept it in the title instead,
 * `![x](a.png "{textus-width=50%}")`, which every other app ignored (and
 * showed as the tooltip); that form is still read (readImagePresentation)
 * and left as written until the width is changed.
 *
 * Both are one image node: an `<img>` tag in the document becomes an image
 * like `![]()` does, with its `width` and its source as written (`html`), so
 * the width menu, the missing-image card, drag and undo work the same. A
 * tag nobody changed is saved byte for byte; once its picture, alt, title
 * or width changes, it is written afresh (imageMarkdownHtml).
 */

/** The attributes of an image node this module reads and writes. */
export interface ImageAttrs {
  src: string;
  alt: string;
  title: string;
  /** The `width` as written - "50%", "320" - or "" for none. */
  width: string;
  /** The `<img>` tag the image was read from, or "" for `![]()`. */
  html: string;
}

// One <img> tag and nothing else, attributes quoted either way or bare.
const IMG_TAG =
  /^<img(?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>$/i;

/** Attributes an image node shows; a tag with any other (height, class,
 *  align...) stays raw HTML, drawn as it always was
 *  (raw-html-preview-plugin.ts), so nothing it says is lost on a resize. */
const IMAGE_ATTRIBUTES = new Set(["src", "alt", "title", "width", "style"]);

/**
 * The picture an `<img>` tag shows, or null when it isn't one an image
 * node can carry: no src, an attribute outside IMAGE_ATTRIBUTES, a width
 * that isn't a number or a percentage, or a style the HTML policy would
 * draw. A style it ignores - Typora's `zoom:50%` - is kept in the source
 * and not shown, as before.
 */
export function parseImageTag(raw: string): Omit<ImageAttrs, "html"> | null {
  const tag = raw.trim();
  if (!IMG_TAG.test(tag)) return null;
  const img = new DOMParser()
    .parseFromString(tag, "text/html")
    .body.querySelector("img");
  if (!img) return null;
  for (const { name } of Array.from(img.attributes))
    if (!IMAGE_ATTRIBUTES.has(name.toLowerCase())) return null;
  const src = img.getAttribute("src") ?? "";
  const width = img.getAttribute("width")?.trim() ?? "";
  if (!src.trim()) return null;
  if (width && !sanitizeDimension(width)) return null;
  if (sanitizeStyle(img.getAttribute("style") ?? "")) return null;
  return {
    src,
    alt: img.getAttribute("alt") ?? "",
    title: img.getAttribute("title") ?? "",
    width,
  };
}

/** An attribute value inside double quotes. A newline is written as a
 *  reference: a raw one would cut the tag over two lines. */
export function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "&#10;");
}

/**
 * How an image is saved: the HTML to write, or null for `![alt](src)`.
 * A tag read from the document comes back as it was while what it says is
 * unchanged; a sized image is `<img>`; anything else is Markdown.
 */
export function imageMarkdownHtml(attrs: ImageAttrs): string | null {
  if (attrs.html) {
    const read = parseImageTag(attrs.html);
    if (
      read &&
      read.src === attrs.src &&
      read.alt === attrs.alt &&
      read.title === attrs.title &&
      read.width === attrs.width
    )
      return attrs.html;
  }
  if (!attrs.width) return null;
  const parts = [`src="${escapeAttribute(attrs.src)}"`];
  if (attrs.alt) parts.push(`alt="${escapeAttribute(attrs.alt)}"`);
  if (attrs.title) parts.push(`title="${escapeAttribute(attrs.title)}"`);
  parts.push(`width="${escapeAttribute(attrs.width)}"`);
  return `<img ${parts.join(" ")}>`;
}

/** `{textus-width=N%}` at the end of the title: where Textus 1.1.0 and
 *  older kept an image's width; documents written by Levis say
 *  `levis-width`. Read the same, for good. */
const IMAGE_WIDTH_METADATA = /\s*\{(?:textus|levis)-width=(\d{1,3})%\}\s*$/;

/** An image title split into the caption it shows and the width an older
 *  Textus kept at its end. */
export function readImagePresentation(title: string | null | undefined): {
  title: string;
  widthPercent: number | null;
} {
  const value = title ?? "";
  const match = IMAGE_WIDTH_METADATA.exec(value);
  if (!match) return { title: value, widthPercent: null };

  const widthPercent = Number(match[1]);
  if (widthPercent < 1 || widthPercent > 100)
    return { title: value, widthPercent: null };
  return {
    title: value.slice(0, match.index).trimEnd(),
    widthPercent,
  };
}

/** The width an image shows at, as HTML writes it ("50%", "320"), or null
 *  for its own size: its `width`, else one an older Textus kept in its
 *  title. */
export function imageWidthOf(attrs: Attrs): string | null {
  const width = (attrs.width as string | undefined) ?? "";
  if (width) return width;
  const legacy = readImagePresentation(attrs.title as string).widthPercent;
  return legacy === null ? null : `${legacy}%`;
}

/**
 * An image's attrs at a new width - a percentage, or null for its own size
 * - saved as `<img width>`, or for null as `![]()`. A width an older Textus
 * kept in the title comes out of it, leaving the caption. Never a null
 * title: the node's title attr validates as a string.
 */
export function withImageWidth(
  attrs: Attrs,
  widthPercent: number | null,
): Attrs {
  return {
    ...attrs,
    title: readImagePresentation(attrs.title as string).title,
    width:
      widthPercent === null
        ? ""
        : `${Math.min(100, Math.max(1, Math.round(widthPercent)))}%`,
  };
}

interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  title?: string;
  data?: unknown;
  children?: MdastNode[];
}

// Where an inline node can't stand on its own and goes in a paragraph.
// Milkdown's remarkHtmlTransformer, which runs first, wraps block HTML in
// one already; this is the fallback should that ever change.
const BLOCK_PARENTS = new Set([
  "root",
  "blockquote",
  "listItem",
  "footnoteDefinition",
]);

function readImageTags(node: MdastNode): void {
  const children = node.children;
  if (!children) return;
  children.forEach((child, i) => {
    if (child.type === "html" && child.value) {
      const read = parseImageTag(child.value);
      if (read) {
        const image: MdastNode = {
          type: "image",
          url: read.src,
          alt: read.alt,
          title: read.title,
          data: { width: read.width, html: child.value },
        };
        children[i] = BLOCK_PARENTS.has(node.type)
          ? { type: "paragraph", children: [image] }
          : image;
        return;
      }
    }
    readImageTags(child);
  });
}

/** Reads each `<img>` tag an image node can carry as one (parseImageTag). */
export const remarkHtmlImages = $remark(
  "remark-html-images",
  () => () => (tree) => readImageTags(tree as unknown as MdastNode),
);
