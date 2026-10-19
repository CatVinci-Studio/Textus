import { errorText } from "../utils/error-text";
import { showConfirm, showMessage } from "../ui/app-dialog";
import type { Strings } from "../i18n/strings";
import { basename, decodeLocalPath, dirname } from "../utils/path";
import { tabTitle, type DocTab } from "../document/doc-tabs";
import { exportDoc, fs } from "../platform/ipc";
import { isMacPlatform, isWindowsPlatform } from "../platform/os";
import { canExportPdf, canExportWithPandoc } from "../platform/capabilities";
import { toPandocMarkdown } from "./pandoc-markdown";
import { diagramsToImages } from "./diagram-images";
import {
  MAC_PAGE,
  WINDOWS_PAGE,
  paginateHtml,
  type PageGeometry,
} from "./paginate";

// File > Export implementations (HTML serializes the live editor DOM;
// everything else converts through a user-installed pandoc; PDF drives the
// system print panel after a themed-render pass - see exportPdf below).

// Keys are pandoc writer names, matching the export menu ids Rust builds in
// menu.rs (EXPORT_PANDOC_PREFIX) - the two lists must stay in step.
const PANDOC_FORMATS: Record<string, { ext: string; label: string }> = {
  docx: { ext: "docx", label: "Word" },
  odt: { ext: "odt", label: "OpenDocument" },
  rtf: { ext: "rtf", label: "RTF" },
  epub: { ext: "epub", label: "EPUB" },
  latex: { ext: "tex", label: "LaTeX" },
  mediawiki: { ext: "wiki", label: "MediaWiki" },
  rst: { ext: "rst", label: "reStructuredText" },
  textile: { ext: "textile", label: "Textile" },
  opml: { ext: "opml", label: "OPML" },
};

// The formats that carry pictures inside the file, so a diagram can go in
// as one; the plain-text ones (LaTeX, MediaWiki, ...) keep its source.
const EMBEDS_IMAGES = new Set(["docx", "odt", "epub", "rtf"]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// The export's default filename stem: the document's name without its
// extension, or the tab title for drafts.
function exportBaseName(tab: DocTab, t: Strings): string {
  return tab.path
    ? basename(tab.path).replace(/\.[^.]+$/, "")
    : tabTitle(tab, t);
}

// --- Standalone document HTML (shared by HTML and PDF export) --------------
//
// Both exports serialize the live editor DOM - what you see is what exports -
// into a self-contained page with every stylesheet inlined. The current
// editor theme is reproduced by mirroring the app root's data-theme /
// data-content-theme / data-user-theme onto the exported <html> (what
// content-themes.css and content-base.css key off) and keeping the same
// ancestor classes.

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// Inlines every same-origin stylesheet's rules into one string.
function collectInlinedCss(): string {
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
// content: heading "#" markers, the code-block language picker, table
// insert buttons, delimiters shown around the caret, AI previews. Kept in
// step with the @media print list in print.css, which hides the same chrome
// when the webview's PDF renderer applies print media.
const EDITOR_CHROME_SELECTOR = [
  ".heading-marker",
  ".image-toolbar",
  ".image-placeholder",
  ".image-resize-handle",
  ".enclosure-delimiter",
  ".code-block-header",
  ".table-add-row-btn",
  ".table-add-col-btn",
  ".ghost-text",
  ".quick-ask-anchor",
  ".pending-insert",
  ".image-resize-handle",
  // Front matter is metadata for tools, not part of the page.
  ".frontmatter-block",
].join(", ");

// A resized table carries pixel widths (an inline table width plus one per
// <col>, see table-hover-view.ts) sized for the editor column. On a page
// narrower than that column they overflow and are cut off at the page edge,
// so the export keeps each column's share of the width instead.
function fitTablesToWidth(root: HTMLElement): void {
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

// Local images render through asset: URLs (image-plugin.ts), which resolve
// only inside this app. A file exported next to the document wants the
// markdown's own paths back ("document"); a self-contained render wants the
// pixels themselves ("inline", see inlineImages).
export type ExportImages = "document" | "inline";

// Clones the editor subtree, stripping contenteditable so the export is inert.
export function cloneEditorContent(
  editor: Element,
  images: ExportImages = "document",
): string {
  const clone = editor.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll("[contenteditable]")
    .forEach((el) => el.removeAttribute("contenteditable"));
  clone.querySelectorAll(EDITOR_CHROME_SELECTOR).forEach((el) => el.remove());
  fitTablesToWidth(clone);
  clone
    .querySelectorAll<HTMLImageElement>("img[data-doc-src]")
    .forEach((img) => {
      // "inline" keeps the document path: inlineImages reads the file.
      if (images === "inline") return;
      img.setAttribute("src", img.dataset.docSrc ?? "");
      img.removeAttribute("data-doc-src");
    });
  return clone.outerHTML;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Replaces every local image in `html` with a data URL, so a render in a
// webview that has no asset protocol (the macOS PDF path) still shows it.
// Read from disk by the document's own path (data-doc-src): fetching the
// asset: URL back through the webview failed on macOS, which left the
// picture as an unloadable asset: link - a blank or "?" in the PDF. The
// fetch stays as the fallback. An image that can't be read is left as-is
// rather than failing the export.
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
};

/** The file a document image src names, or null for a URL. */
export function localImagePath(
  src: string,
  docPath: string | null,
): string | null {
  if (!src) return null;
  if (/^[a-z]:[\\/]/i.test(src) || src.startsWith("/"))
    return decodeLocalPath(src);
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || !docPath) return null;
  return `${dirname(docPath)}/${decodeLocalPath(src)}`;
}

async function inlineImages(
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
      if (path) {
        const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";
        try {
          const data = await fs.readBinaryFileBase64(path);
          if (data) {
            img.src = `data:${IMAGE_MIME[ext] ?? "image/png"};base64,${data}`;
            return;
          }
        } catch {
          // Unreadable from disk - try the webview's copy below.
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
function buildStandaloneHtml(
  base: string,
  contentHtml: string,
  layoutCss: string,
): string {
  const root = document.documentElement;
  // Pin the appearance the page was exported in. Following the system
  // (no data-theme) would let a reader's dark mode restyle the text while
  // the diagrams keep the colours they were rendered with.
  const dataTheme =
    root.getAttribute("data-theme") ??
    (window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light");
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

const isMac = isMacPlatform();

// Layout shared by every export: content too wide for a page wraps or
// shrinks to fit instead of being clipped at the sheet edge. Display math
// is a scroll box on screen; a page cannot scroll, so let KaTeX break at
// its top-level operators like inline math does.
const EXPORT_FIT_CSS =
  ".milkdown table { width: 100%; } " +
  ".math-block-rendered, .katex-display { overflow: visible; } " +
  ".katex-display > .katex { white-space: normal; } " +
  ".milkdown a, .milkdown p, .milkdown li, .milkdown td, .milkdown th { overflow-wrap: anywhere; } ";

// Theme + page CSS for the offscreen PDF render. print-color-adjust keeps
// the editor theme's backgrounds from being flattened to white per page.
//
// With a known page geometry (macOS, Windows) the sheet margin stays zero so
// the theme background bleeds to every edge - WebKit never paints an @page
// margin, which would leave white bands on tinted themes - and the top and
// bottom margins are laid out instead, by paginate.ts pushing blocks
// off each page seam. Without one (Linux, where WebKitGTK's print geometry
// isn't pinned down) the GTK page setup gives each sheet a real top and
// bottom margin (export.rs): text stays clear of the seams, at the cost of
// plain margins on a tinted theme. Every platform ends up near 20mm all
// round, the margin of a printed page.
//
// WebKitGTK paints the root background only as far as the document reaches,
// so the last sheet ended in white below the text. A body shadow paints
// past the content without adding layout height (no extra blank page);
// the print clips it to each sheet's printable area.
export function pdfLayoutCss(page: PageGeometry | null): string {
  const side = Math.round((page?.width ?? 595) * 0.094);
  return (
    ":root { -webkit-print-color-adjust: exact; print-color-adjust: exact; } " +
    // The sheet itself never has a CSS margin: macOS and Windows lay theirs
    // out (export-paginate), and on Linux the GTK page setup holds it
    // (export.rs) - WebKitGTK ignores an @page margin.
    "@page { margin: 0; } " +
    "html, body { margin: 0; background: var(--editor-bg, var(--bg)); } " +
    ".app-shell, .main-pane, .editor-scroll { height: auto; overflow: visible; background: transparent; } " +
    `.editor-content, .editor-content.typewriter-active { max-width: none; padding: ${page ? page.margin : 0}px ${side}px 0; } ` +
    (page
      ? ""
      : "body { box-shadow: 0 0 0 4000px var(--editor-bg, var(--bg)); } " +
        "pre, blockquote, table, img, .math-block-wrapper, .mermaid-preview, .md-alert { break-inside: avoid; } " +
        // WebKitGTK's print-to-file ignores break-inside on a block, and cut
        // a display formula in two at the seam; an inline-block it never
        // splits.
        ".math-block-wrapper, .mermaid-preview { display: inline-block; width: 100%; } ") +
    EXPORT_FIT_CSS
  );
}

/** The sheet geometry the native renderer on this platform lays out, or
 *  null where it isn't known (see pdfLayoutCss). */
function platformPage(): PageGeometry | null {
  if (isMac) return MAC_PAGE;
  if (isWindowsPlatform()) return WINDOWS_PAGE;
  return null;
}

const HTML_LAYOUT_CSS =
  ".app-shell, .main-pane, .editor-scroll { height: auto; overflow: visible; } " +
  ".editor-content { padding: 2rem 1.5rem; } " +
  EXPORT_FIT_CSS;

// Injects the "Preparing PDF…" progress overlay (removed when export ends).
function showPdfOverlay(t: Strings): HTMLElement {
  const el = document.createElement("div");
  el.className = "pdf-export-overlay";
  el.innerHTML = `<div class="pdf-export-card"><div class="pdf-export-spinner" aria-hidden="true"></div><div class="pdf-export-text">${escapeHtml(t.pdfPreparing)}</div></div>`;
  document.body.appendChild(el);
  return el;
}

// Lets web fonts (theme fonts like Parchment's script face) and images settle
// before serializing, so the offscreen render doesn't miss them. Diagrams and
// math are already inline SVG/HTML in the DOM, so no extra pass is needed.
async function settleRender(editor: Element): Promise<void> {
  try {
    await document.fonts.ready;
  } catch {
    // Font loading API unavailable or rejected - continue with what's loaded.
  }
  const images = Array.from(editor.querySelectorAll("img"));
  await Promise.all(
    images.map((img) =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : img.decode().catch(() => undefined),
    ),
  );
  await nextFrame();
}

// File > Export as PDF. Requires the WYSIWYG view (source mode has no themed
// DOM) and exports the active tab as-is - unsaved edits included.
export async function exportPdf(tab: DocTab, t: Strings): Promise<void> {
  if (!canExportPdf) return;
  const editor = document.querySelector('[data-active-tab="true"] .milkdown');
  if (!editor) {
    await showMessage(t.exportNeedsWysiwyg, { title: t.exportFailedTitle });
    return;
  }
  const base = exportBaseName(tab, t);
  const picked = await exportDoc.exportSaveDialog(`${base}.pdf`, "PDF", "pdf");
  if (!picked) return;
  const overlay = showPdfOverlay(t);
  try {
    await nextFrame();
    await settleRender(editor);
    const content = await inlineImages(
      cloneEditorContent(editor, "inline"),
      tab.path,
    );
    const page = platformPage();
    const standalone = buildStandaloneHtml(base, content, pdfLayoutCss(page));
    const html = page ? await paginateHtml(standalone, page) : standalone;
    // Resolves once the file is written.
    await exportDoc.exportPdfNative({
      html,
      // Resolves relative image srcs (assets/...) against the document folder.
      baseDir: tab.path ? dirname(tab.path) : null,
      outputPath: picked,
    });
    void exportDoc.revealInDir(picked);
  } catch (err) {
    // Off before the message: the overlay sits above the app's dialogs, so
    // left up it covered the error and its button, and the spinner never
    // stopped (#62).
    overlay.remove();
    await showMessage(`${t.pdfFailed} ${errorText(err)}`, {
      title: t.exportFailedTitle,
      tone: "error",
    });
  } finally {
    overlay.remove();
  }
}

// Serializes the tab's live editor DOM into a self-contained HTML file.
// Saved next to the document, relative image paths (assets/...) are kept
// as-is, like Typora's HTML export; anywhere else (or for a document never
// saved, whose pictures sit in the app's own folder) they would point at
// nothing, so the pictures are embedded instead.
export async function exportHtml(tab: DocTab, t: Strings): Promise<void> {
  const editor = document.querySelector('[data-active-tab="true"] .milkdown');
  if (!editor) {
    await showMessage(t.exportNeedsWysiwyg, { title: t.exportFailedTitle });
    return;
  }
  const base = exportBaseName(tab, t);
  const picked = await exportDoc.exportSaveDialog(
    `${base}.html`,
    "HTML",
    "html",
  );
  if (!picked) return;
  const beside = !!tab.path && dirname(tab.path) === dirname(picked);
  await settleRender(editor);
  const content = beside
    ? cloneEditorContent(editor)
    : await inlineImages(cloneEditorContent(editor, "inline"), tab.path);
  const html = buildStandaloneHtml(base, content, HTML_LAYOUT_CSS);
  await fs.writeTextFile(picked, html);
  void exportDoc.revealInDir(picked);
}

export async function exportViaPandoc(
  tab: DocTab,
  format: string,
  t: Strings,
): Promise<void> {
  const info = PANDOC_FORMATS[format];
  if (!info || !canExportWithPandoc) return;
  const pandoc = await exportDoc.detectPandoc();
  if (!pandoc) {
    // Typora's model: guide the user to install pandoc rather than
    // bundling the ~180MB GPL binary in the app.
    const goInstall = await showConfirm(t.pandocMissingMessage, {
      title: t.pandocMissingTitle,
      okLabel: t.pandocMissingDownload,
      cancelLabel: t.closePromptCancel,
    });
    if (goInstall) void exportDoc.openPandocInstallPage();
    return;
  }
  const base = exportBaseName(tab, t);
  const picked = await exportDoc.exportSaveDialog(
    `${base}.${info.ext}`,
    info.label,
    info.ext,
  );
  if (!picked) return;
  try {
    // tab.content, not the file on disk - unsaved edits export too.
    const text = toPandocMarkdown(tab.content, {
      NOTE: t.alertNote,
      TIP: t.alertTip,
      IMPORTANT: t.alertImportant,
      WARNING: t.alertWarning,
      CAUTION: t.alertCaution,
    });
    await exportDoc.exportViaPandoc({
      pandocPath: pandoc,
      markdown: EMBEDS_IMAGES.has(format) ? await diagramsToImages(text) : text,
      outputPath: picked,
      format,
      resourceDir: tab.path ? dirname(tab.path) : null,
      title: base,
    });
    void exportDoc.revealInDir(picked);
  } catch (err) {
    await showMessage(`${t.exportFailed} ${errorText(err)}`, {
      title: t.exportFailedTitle,
      tone: "error",
    });
  }
}
