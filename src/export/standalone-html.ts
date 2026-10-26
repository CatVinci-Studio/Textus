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
import { placeDrawnPictures } from "./drawn-blocks";
import {
  COLOR_SWATCH_CLASS,
  COLOR_SWATCH_TEXT_CLASS,
} from "../editor/marks/color-swatch-classes";

/**
 * The document as one HTML file (exporters.ts): the editor's content
 * cloned without its chrome, links as written, folded details opened,
 * tables fitted, pictures inlined, and the app's styles carried along.
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

// Editing affordances that live in the editor DOM but are not document
// content: heading "#" markers, the code-block header (copy button and
// language picker) and line numbers, colour swatches, table
// insert buttons, delimiters shown around the caret, AI previews. Kept in
// step with the @media print list in print.css, which hides the same chrome
// when the webview's PDF renderer applies print media.
export const EDITOR_CHROME_SELECTOR = [
  ".heading-marker",
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
  // A missing image's card and its buttons: the page keeps the image as
  // written (cloneEditorContent).
  `.${MISSING_IMAGE_CARD_CLASS}`,
].join(", ");

// A resized table carries pixel widths (an inline table width plus one per
// <col>, see table-hover-view.ts) sized for the editor column. On a page
// narrower than that column they overflow and are cut off at the page edge,
// so the export keeps each column's share of the width instead.
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

// A <details> written around markdown shows in the editor as a head widget
// with the document's own paragraphs below it, hidden while folded
// (editor/html/details-fold.ts). A page has no editor to fold them, so they
// go back inside one real <details>, which opens and closes by itself.
// Innermost first, so a nested one moves into its parent whole.
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

// Local images render through asset: URLs (image-plugin.ts), which resolve
// only inside this app. A file exported next to the document wants the
// markdown's own paths back ("document"); a self-contained render wants the
// pixels themselves ("inline", see inlineImages, which reads each from the
// file data-doc-src names - left on the image for it).
export type ExportImages = "document" | "inline";

// A link shown as its Markdown while the caret is on it
// (editor/markdown/link-reveal.ts).
export const LINK_SOURCE_SELECTOR = '[data-type="link_source"]';

const renderHtml = lazyModule(
  "render-html",
  () => import("../editor/markdown/render-html"),
);

// What draws a link shown as its Markdown, when the editor has one: the
// renderer stays out of the entry chunk otherwise (see color-swatch-classes.ts).
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
  // A picture the editor loads only near the screen (a large document's)
  // loads at once in the page made from this.
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

// The file a document image's src names, decoded as the editor reads it
// (image-plugin.ts's resolveImageSrc); null for a URL, or a relative src
// with no folder on disk to resolve it in.
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

// Replaces every local image in `html` with a data URL, so a render in a
// webview that has no asset protocol (the macOS PDF path), or a page opened
// away from the document's folder, still shows it. Each is read from its
// file on disk (data-doc-src, against `docPath`) rather than fetched back
// through the webview, where a fetch the asset protocol didn't answer left
// the picture an unloadable link, blank in the PDF. The fetch stays for an
// image with no file to read (an iOS document's). An image that can't be
// read is left as-is rather than failing the export.
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

// Wraps serialized editor content in a full themed document. `layoutCss` frees
// it from the app's fixed-viewport layout (each export tunes its own page).
// `light` renders the theme's light form whatever the app shows, for a page
// printed on white (see pdfLayoutCss).
export function buildStandaloneHtml(
  base: string,
  contentHtml: string,
  layoutCss: string,
  light = false,
): string {
  const root = document.documentElement;
  // Pin the appearance the page was exported in. Following the system
  // (no data-theme) would let a reader's dark mode restyle the text while
  // the diagrams keep the colours they were rendered with.
  const dataTheme = light
    ? "light"
    : (root.getAttribute("data-theme") ??
      (window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"));
  const contentTheme = root.getAttribute("data-content-theme");
  // An imported theme switches Textus's own ornaments off (content-base.css);
  // the export has to say so too, or they come back on the page.
  const userTheme = root.hasAttribute("data-user-theme");
  const rootAttrs =
    (dataTheme ? ` data-theme="${escapeHtml(dataTheme)}"` : "") +
    (contentTheme ? ` data-content-theme="${escapeHtml(contentTheme)}"` : "") +
    (userTheme ? " data-user-theme" : "");
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

// --- PDF export -------------------------------------------------------------
//
// PDF export never goes through a print dialog or a printer driver: the
// themed document is laid out into A4 pages here and rendered straight to a
// file natively - vector, selectable text (export_pdf_native in Rust:
// WKWebView.createPDF on macOS, WebView2's PrintToPdf on Windows, WebKitGTK's
// print-to-file on Linux). wry's window.print() was never an option on macOS
// anyway - it drives a broken NSPrintPanel that flashes and self-dismisses
// (tauri-apps/wry#713, tauri#6202).
