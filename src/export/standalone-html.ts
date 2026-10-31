import {
  decodeUrlPath,
  dirname,
  hasUrlScheme,
  isDrivePath,
} from "../utils/path";
import { imageMimeForPath } from "../editor/images/pasted-files";
import { fs } from "../platform/ipc";
import { escapeHtml } from "../utils/html";
import { lazyModule } from "../lazy/lazy-module";
import {
  DETAILS_CLASS_PREFIX,
  DETAILS_END_CLASS,
  DETAILS_FOLDED_CLASS,
  DETAILS_HEAD_ATTR,
  DETAILS_IN_CLASS,
} from "../editor/html/details-fold";
import {
  MISSING_IMAGE_CARD_CLASS,
  MISSING_IMAGE_CLASS,
} from "../editor/images/missing-image";
import { CODE_LINE_NUMBERS_CLASS } from "../editor/code/code-line-numbers-plugin";
import { EMOJI_SOURCE_CLASS } from "../editor/emoji/emoji-classes";
import { placeDrawnPictures } from "./drawn-blocks";
import {
  COLOR_SWATCH_CLASS,
  COLOR_SWATCH_TEXT_CLASS,
} from "../editor/marks/color-swatch-classes";

/**
 * The document as one HTML file: the editor's content without its chrome,
 * pictures inlined, and the app's styles carried along.
 */

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// Inlines every same-origin stylesheet's rules into one string.
export function collectInlinedCss(): string {
  let css = "";
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      css += Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
      css += "\n";
    } catch {
      // Cross-origin sheet (none in practice) - skip.
    }
  }
  return css;
}

// Editing affordances in the editor DOM that aren't document content. Keep
// in step with print.css's @media print list.
export const EDITOR_CHROME_SELECTOR = [
  ".heading-marker",
  `.${EMOJI_SOURCE_CLASS}`,
  ".enclosure-delimiter",
  ".code-block-header",
  ".mermaid-zoom",
  ".code-line-gutter",
  `.${COLOR_SWATCH_CLASS}`,
  ".table-add-row-btn",
  ".table-add-col-btn",
  ".ghost-text",
  ".quick-ask-anchor",
  ".pending-insert",
  ".image-resize-handle",
  // Front matter is metadata for tools, not part of the page.
  ".frontmatter-block",
  // A missing image's card: the page keeps the image as written.
  `.${MISSING_IMAGE_CARD_CLASS}`,
  // Anything drawn for the editor alone (a plugin's badge).
  "[data-editor-chrome]",
].join(", ");

/** Marks over the text drawn for the editor alone (a plugin's highlight
 *  or underline): the copy keeps their text, not them. */
export const EDITOR_MARK_SELECTOR = "[data-editor-mark]";

// A resized table carries pixel widths sized for the editor column, cut off
// on a narrower page, so the export keeps each column's share instead.
export function fitTablesToWidth(root: HTMLElement): void {
  root.querySelectorAll("table").forEach((table) => {
    table.style.width = "";
    table.style.minWidth = "";
    const cols = Array.from(table.querySelectorAll(":scope > colgroup > col"));
    const widths = cols.map(
      (col) => parseFloat((col as HTMLElement).style.width) || 0,
    );
    const total = widths.reduce((sum, width) => sum + width, 0);
    cols.forEach((col, i) => {
      const style = (col as HTMLElement).style;
      // Unsized columns share what the sized ones leave.
      style.width =
        total > 0 && widths[i] > 0 && widths.every((w) => w > 0)
          ? `${((widths[i] / total) * 100).toFixed(3)}%`
          : "";
    });
  });
}

// Folded <details> are paragraphs hidden below a head widget in the editor;
// a page puts them back inside one real <details>. Innermost first, so a
// nested one moves into its parent whole.
export function gatherDetails(root: HTMLElement): void {
  const heads = Array.from(
    root.querySelectorAll<HTMLDetailsElement>(`details[${DETAILS_HEAD_ATTR}]`),
  ).reverse();
  for (const details of heads) {
    const id = details.getAttribute(DETAILS_HEAD_ATTR);
    details.removeAttribute(DETAILS_HEAD_ATTR);
    let block: Element = details;
    while (block.parentElement && !block.parentElement.matches(".ProseMirror"))
      block = block.parentElement;
    if (block === details || !block.parentElement) continue;
    // The head paragraph's classes say which outer <details> it is in.
    for (const cls of Array.from(block.classList))
      if (cls.startsWith(DETAILS_CLASS_PREFIX)) details.classList.add(cls);
    const body = Array.from(
      block.parentElement.querySelectorAll(
        `:scope > .${DETAILS_IN_CLASS}${id}`,
      ),
    );
    for (const el of body) {
      el.classList.remove(`${DETAILS_IN_CLASS}${id}`);
      el.classList.remove(DETAILS_FOLDED_CLASS);
      details.appendChild(el);
    }
    block.replaceWith(details);
  }
  root.querySelectorAll(`.${DETAILS_END_CLASS}`).forEach((el) => el.remove());
}

// Local images render through app-only asset: URLs. "document" restores the
// markdown's paths; "inline" embeds the pixels, read from data-doc-src.
export type ExportImages = "document" | "inline";

// A link shown as its Markdown while the caret is on it.
export const LINK_SOURCE_SELECTOR = '[data-type="link_source"]';

const renderHtml = lazyModule(
  "render-html",
  () => import("../editor/markdown/render-html"),
);

// Loaded only when the editor has such a link, to keep it out of the entry chunk.
export async function linkRenderer(
  editor: Element,
): Promise<((markdown: string) => string) | undefined> {
  if (!editor.querySelector(LINK_SOURCE_SELECTOR)) return undefined;
  return (await renderHtml.load()).renderMarkdownInlineHtml;
}

// Clones the editor subtree, stripping contenteditable so the export is inert.
export function cloneEditorContent(
  editor: Element,
  images: ExportImages = "document",
  renderLink?: (markdown: string) => string,
): string {
  const clone = editor.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll("[contenteditable]")
    .forEach((el) => el.removeAttribute("contenteditable"));
  clone.querySelectorAll(EDITOR_CHROME_SELECTOR).forEach((el) => el.remove());
  clone
    .querySelectorAll(EDITOR_MARK_SELECTOR)
    .forEach((el) => el.replaceWith(...el.childNodes));
  placeDrawnPictures(clone);
  // Without its card, a missing image is the <img> it always was.
  clone
    .querySelectorAll(`.${MISSING_IMAGE_CLASS}`)
    .forEach((el) => el.classList.remove(MISSING_IMAGE_CLASS));
  // Nor do its lines stop wrapping, without the numbers they made room for.
  clone
    .querySelectorAll(`.${CODE_LINE_NUMBERS_CLASS}`)
    .forEach((el) => el.classList.remove(CODE_LINE_NUMBERS_CLASS));
  // The link the caret is on shows as its Markdown; the page has the link.
  clone.querySelectorAll(LINK_SOURCE_SELECTOR).forEach((el) => {
    const link = document.createElement("span");
    link.innerHTML = renderLink?.(el.textContent ?? "") ?? "";
    el.replaceWith(
      ...(link.childNodes.length ? link.childNodes : [el.textContent ?? ""]),
    );
  });
  // A colour code in plain text draws its swatch before its first
  // character; the character goes back into the text around it.
  clone
    .querySelectorAll(`.${COLOR_SWATCH_TEXT_CLASS}`)
    .forEach((el) => el.replaceWith(...el.childNodes));
  // A lazily loaded picture loads at once in the page.
  clone
    .querySelectorAll("img[loading]")
    .forEach((img) => img.removeAttribute("loading"));
  gatherDetails(clone);
  fitTablesToWidth(clone);
  clone
    .querySelectorAll<HTMLImageElement>("img[data-doc-src]")
    .forEach((img) => {
      if (images === "inline") return;
      img.setAttribute("src", img.dataset.docSrc ?? "");
      img.removeAttribute("data-doc-src");
    });
  return clone.outerHTML;
}

// The file a document image's src names; null for a URL, or a relative src
// with no folder on disk.
export function localImagePath(
  src: string,
  docPath: string | null,
): string | null {
  if (isDrivePath(src)) return decodeUrlPath(src);
  if (!src || hasUrlScheme(src)) return null;
  if (src.startsWith("/")) return decodeUrlPath(src);
  // An iOS document picked in Files is a file: URL, its images no plain path.
  if (!docPath || hasUrlScheme(docPath)) return null;
  return `${dirname(docPath)}/${decodeUrlPath(src)}`;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Replaces every local image with a data URL, read from its file on disk
// rather than fetched through the webview, where an unanswered asset fetch
// left a blank picture. The fetch stays for images with no file (iOS).
// An unreadable image is left as-is rather than failing the export.
export async function inlineImages(
  html: string,
  docPath: string | null,
): Promise<string> {
  const template = document.createElement("template");
  template.innerHTML = html;
  const images = Array.from(
    template.content.querySelectorAll<HTMLImageElement>("img[src]"),
  );
  await Promise.all(
    images.map(async (img) => {
      const path = localImagePath(img.dataset.docSrc ?? "", docPath);
      img.removeAttribute("data-doc-src");
      const mime = path && imageMimeForPath(path);
      if (path && mime) {
        try {
          img.src = `data:${mime};base64,${await fs.readBinaryFileBase64(path)}`;
          return;
        } catch {
          // Not readable from disk - try the webview's copy below.
        }
      }
      if (!/^(asset|https?:\/\/asset\.localhost)/i.test(img.src)) return;
      try {
        const response = await fetch(img.src);
        if (response.ok) img.src = await blobToDataUrl(await response.blob());
      } catch {
        // Unreadable - keep the original src.
      }
    }),
  );
  return template.innerHTML;
}

// Wraps serialized editor content in a full themed document. `light` renders
// the theme's light form, for a page printed on white.
export function buildStandaloneHtml(
  base: string,
  contentHtml: string,
  layoutCss: string,
  light = false,
): string {
  const root = document.documentElement;
  // Pin the exported appearance, or a reader's dark mode restyles the text
  // while diagrams keep their rendered colours.
  const dataTheme = light
    ? "light"
    : (root.getAttribute("data-theme") ??
      (window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"));
  const contentTheme = root.getAttribute("data-content-theme");
  // An imported theme switches Textus's own ornaments off; the export must too.
  const userTheme = root.hasAttribute("data-user-theme");
  const imageAlign = root.getAttribute("data-image-align");
  const rootAttrs =
    (dataTheme ? ` data-theme="${escapeHtml(dataTheme)}"` : "") +
    (contentTheme ? ` data-content-theme="${escapeHtml(contentTheme)}"` : "") +
    (userTheme ? " data-user-theme" : "") +
    (imageAlign ? ` data-image-align="${escapeHtml(imageAlign)}"` : "");
  return `<!doctype html>
<html${rootAttrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(base)}</title>
<style>${collectInlinedCss()}</style>
<style>${layoutCss}</style>
</head>
<body class="${document.body.className}">
<div class="app-shell"><div class="main-pane"><div class="editor-scroll"><div class="editor-content">${contentHtml}</div></div></div></div>
</body>
</html>`;
}
