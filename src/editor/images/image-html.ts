import { $remark } from "@milkdown/kit/utils";
import type { Attrs } from "@milkdown/kit/prose/model";
import { escapeHtml } from "../../utils/html";
import { sanitizeDimension, sanitizeStyle } from "../html/html-policy";

/**
 * A sized image is written as `<img ... width="50%">`, the one width form
 * GitHub, VS Code, Typora and Obsidian all show. An `<img>` tag reads as an
 * image node, and one nobody changed is saved byte for byte.
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

/** Attributes an image node shows; a tag with any other stays raw HTML, so
 *  nothing it says is lost on a resize. */
const IMAGE_ATTRIBUTES = new Set(["src", "alt", "title", "width", "style"]);

/**
 * The picture an `<img>` tag shows, or null when an image node can't carry
 * it. A style the policy ignores (Typora's `zoom:50%`) is kept, not shown.
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
 * How an image is saved: the HTML to write, or null for `![alt](src)`. An
 * unchanged tag comes back as it was; a sized image is `<img>`.
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

/** `{textus-width=N%}` at the end of the title: an older form of an image's
 *  width, still read. */
const IMAGE_WIDTH_METADATA = /\s*\{textus-width=(\d{1,3})%\}\s*$/;

/** An image title split into its caption and the older title-kept width. */
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

/** The width an image shows at, as HTML writes it, or null for its own
 *  size: its `width`, else one kept in its title. */
export function imageWidthOf(attrs: Attrs): string | null {
  const width = (attrs.width as string | undefined) ?? "";
  if (width) return width;
  const legacy = readImagePresentation(attrs.title as string).widthPercent;
  return legacy === null ? null : `${legacy}%`;
}

/**
 * An image's attrs at a new width, or null for its own size. A width kept
 * in the title comes out of it. Never a null title: it validates as a string.
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

// Where an inline node goes in a paragraph. remarkHtmlTransformer wraps
// block HTML already; this is the fallback.
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

/** Reads each `<img>` tag an image node can carry as one. */
export const remarkHtmlImages = $remark(
  "remark-html-images",
  () => () => (tree) => readImageTags(tree as MdastNode),
);
