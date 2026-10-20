import { errorText } from "../utils/error-text";
import { showConfirm, showMessage } from "../ui/app-dialog";
import type { Strings } from "../i18n/strings";
import {
  basename,
  decodeUrlPath,
  dirname,
  hasUrlScheme,
  isDrivePath,
} from "../utils/path";
import { imageMimeForPath } from "../editor/images/pasted-files";
import { katexLoaded, loadKatex } from "../editor/math/katex-loader";
import { drawEverything } from "../editor/draw-when-visible";
import { tabTitle, type DocTab } from "../document/doc-tabs";
import { exportDoc, fs } from "../platform/ipc";
import { isMacPlatform, isWindowsPlatform } from "../platform/os";
import { canExportPdf, canExportWithPandoc } from "../platform/capabilities";
import { toPandocMarkdown } from "./pandoc-markdown";
import { diagramsToImages, lightDiagrams } from "./diagram-images";
import { appearanceIsDark } from "../editor/diagram-engine";
import type { DiagramEngine } from "../settings/SettingsContext";
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
import {
  COLOR_SWATCH_CLASS,
  COLOR_SWATCH_TEXT_CLASS,
} from "../editor/marks/color-swatch-plugin";
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
// content: heading "#" markers, the code-block header (copy button and
// language picker) and line numbers, colour swatches, table
// insert buttons, delimiters shown around the caret, AI previews. Kept in
// step with the @media print list in print.css, which hides the same chrome
// when the webview's PDF renderer applies print media.
const EDITOR_CHROME_SELECTOR = [
  ".heading-marker",
  ".enclosure-delimiter",
  ".code-block-header",
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

// A <details> written around markdown shows in the editor as a head widget
// with the document's own paragraphs below it, hidden while folded
// (editor/html/details-fold.ts). A page has no editor to fold them, so they
// go back inside one real <details>, which opens and closes by itself.
// Innermost first, so a nested one moves into its parent whole.
function gatherDetails(root: HTMLElement): void {
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
  // Without its card, a missing image is the <img> it always was.
  clone
    .querySelectorAll(`.${MISSING_IMAGE_CLASS}`)
    .forEach((el) => el.classList.remove(MISSING_IMAGE_CLASS));
  // Nor do its lines stop wrapping, without the numbers they made room for.
  clone
    .querySelectorAll(`.${CODE_LINE_NUMBERS_CLASS}`)
    .forEach((el) => el.classList.remove(CODE_LINE_NUMBERS_CLASS));
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
function localImagePath(src: string, docPath: string | null): string | null {
  if (isDrivePath(src)) return decodeUrlPath(src);
  if (!src || hasUrlScheme(src)) return null;
  if (src.startsWith("/")) return decodeUrlPath(src);
  // An iOS document picked in Files is a file: URL, its images no plain path.
  if (!docPath || hasUrlScheme(docPath)) return null;
  return `${dirname(docPath)}/${decodeUrlPath(src)}`;
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
// webview that has no asset protocol (the macOS PDF path), or a page opened
// away from the document's folder, still shows it. Each is read from its
// file on disk (data-doc-src, against `docPath`) rather than fetched back
// through the webview, where a fetch the asset protocol didn't answer left
// the picture an unloadable link, blank in the PDF. The fetch stays for an
// image with no file to read (an iOS document's). An image that can't be
// read is left as-is rather than failing the export.
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
// the theme's own backgrounds (code blocks, quotes) from being dropped.
//
// `whitePage` prints the page itself on white, as paper is (Windows and
// Linux, #68): the theme's page colour goes, and exportPdf renders the
// theme's light form, so a dark theme's pale text never lands on white.
// macOS keeps the page in the theme's own colour.
//
// With a known page geometry (macOS, Windows) the sheet margin stays zero so
// the page colour bleeds to every edge - WebKit never paints an @page
// margin, which would leave white bands on tinted themes - and the top and
// bottom margins are laid out instead, by paginate.ts pushing blocks
// off each page seam. Without one (Linux, where WebKitGTK's print geometry
// isn't pinned down) the GTK page setup gives each sheet a real top and
// bottom margin (export.rs). Every platform ends up near 20mm all round,
// the margin of a printed page.
export function pdfLayoutCss(
  page: PageGeometry | null,
  whitePage = false,
): string {
  const side = Math.round((page?.width ?? 595) * 0.094);
  const background = whitePage ? "#fff" : "var(--editor-bg, var(--bg))";
  return (
    ":root { -webkit-print-color-adjust: exact; print-color-adjust: exact; } " +
    // Whatever paints with the page colour (sticky bars, cut-outs) matches.
    (whitePage ? ":root { --editor-bg: #fff !important; } " : "") +
    // macOS and Windows lay their margins out (paginate.ts), so the sheet
    // has none. On Linux the GTK page setup holds them (export.rs), and only
    // `auto` leaves them to it: given a CSS margin - even the 0 this used
    // to set, or print.css's - WebKitGTK cut its pages that much taller but
    // still drew each one below the setup's top margin, so a page's last
    // lines ran off the sheet and were lost.
    `@page { margin: ${page ? "0" : "auto"}; } ` +
    `html, body { margin: 0; background: ${background}; } ` +
    ".app-shell, .main-pane, .editor-scroll { height: auto; overflow: visible; background: transparent; } " +
    `.editor-content, .editor-content.typewriter-active { max-width: none; padding: ${page ? page.margin : 0}px ${side}px 0; } ` +
    (page
      ? ""
      : "pre, blockquote, table, img, .math-block-wrapper, .mermaid-preview, .md-alert { break-inside: avoid; } " +
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

// KaTeX loads on a document's first formula (katex-loader.ts); one still
// waiting for it would export as its source, and without KaTeX's
// stylesheet among the rules collectInlinedCss copies. Drawn first. So is
// every formula and diagram still waiting to come near the screen
// (draw-when-visible.ts): the export copies the page as it is.
async function drawMath(editor: Element): Promise<void> {
  if (
    !katexLoaded() &&
    editor.querySelector('[data-type="math_inline"], [data-type="math_block"]')
  ) {
    try {
      await loadKatex();
      await nextFrame();
    } catch {
      // Exported as source rather than not at all.
    }
  }
  await drawEverything(editor);
}

// Lets web fonts (theme fonts like Parchment's script face) and images settle
// before serializing, so the offscreen render doesn't miss them. Diagrams and
// math are already inline SVG/HTML in the DOM (drawMath), so no extra pass
// is needed.
async function settleRender(editor: Element): Promise<void> {
  await drawMath(editor);
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
// `pageNumbers` (Settings › Page numbers in PDF) has Rust number the
// finished file's pages; the render itself is the same either way.
export async function exportPdf(
  tab: DocTab,
  t: Strings,
  pageNumbers = false,
): Promise<void> {
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
    // Paper is white: macOS keeps the theme's page colour, the others print
    // on white in the theme's light form (#68).
    const whitePage = !isMac;
    let content = await inlineImages(
      cloneEditorContent(editor, "inline"),
      tab.path,
    );
    if (whitePage && appearanceIsDark()) {
      const style = getComputedStyle(editor);
      content = await lightDiagrams(
        content,
        editor.clientWidth - 40,
        style.fontFamily,
      );
    }
    const page = platformPage();
    const standalone = buildStandaloneHtml(
      base,
      content,
      pdfLayoutCss(page, whitePage),
      whitePage,
    );
    const html = page ? await paginateHtml(standalone, page) : standalone;
    // Resolves once the file is written.
    await exportDoc.exportPdfNative({
      html,
      // Resolves relative image srcs (assets/...) against the document folder.
      baseDir: tab.path ? dirname(tab.path) : null,
      outputPath: picked,
      pageNumbers,
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
// as-is, like Typora's HTML export. Anywhere else they would point at
// nothing - nor would a draft's, in the app's own folder - so the pictures
// go inside the page.
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
  await drawMath(editor);
  const besideDocument = !!tab.path && dirname(tab.path) === dirname(picked);
  const content = besideDocument
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
  diagramEngine: DiagramEngine,
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
      markdown: EMBEDS_IMAGES.has(format)
        ? await diagramsToImages(text, diagramEngine)
        : text,
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
