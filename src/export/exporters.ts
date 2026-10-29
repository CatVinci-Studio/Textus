import { escapeHtml } from "../utils/html";
import { showConfirm, showMessage } from "../ui/app-dialog";
import type { Strings } from "../i18n/strings";
import { basename, dirname } from "../utils/path";
import { katexLoaded, loadKatex } from "../editor/math/katex-loader";
import { drawEverything } from "../editor/draw-when-visible";
import { tabTitle, type DocTab } from "../document/doc-tabs";
import { exportDoc, fs } from "../platform/ipc";
import { isMacPlatform, isWindowsPlatform } from "../platform/os";
import { canExportPdf, canExportWithPandoc } from "../platform/capabilities";
import { toPandocMarkdown } from "./pandoc-markdown";
import {
  diagramsToImages,
  drawnBlocksToImages,
  lightDiagrams,
} from "./diagram-images";
import { drawnPicturesByLanguage, markDrawnPictures } from "./drawn-blocks";
import { finishExportPage } from "./export-step";
import { appearanceIsDark } from "../editor/diagram-engine";
import type { DiagramEngine } from "../prefs/SettingsContext";
import {
  MAC_PAGE,
  WINDOWS_PAGE,
  paginateHtml,
  type PageGeometry,
} from "./paginate";
import {
  buildStandaloneHtml,
  cloneEditorContent,
  inlineImages,
  linkRenderer,
  nextFrame,
} from "./standalone-html";
export {
  type ExportImages,
  cloneEditorContent,
  buildStandaloneHtml,
} from "./standalone-html";
import { explainError } from "../utils/error-explain";
// File > Export: HTML serializes the live editor DOM, PDF prints a themed
// render, everything else converts through a user-installed pandoc.

// Keys are pandoc writer names; keep in step with menu.rs's export ids.
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

function exportBaseName(tab: DocTab, t: Strings): string {
  return tab.path
    ? basename(tab.path).replace(/\.[^.]+$/, "")
    : tabTitle(tab, t);
}

// Standalone HTML (HTML and PDF export): the live editor DOM with every
// stylesheet inlined and the app root's theme attributes mirrored.

const isMac = isMacPlatform();

// Content too wide for a page wraps or shrinks instead of being clipped. A
// page can't scroll, so display math breaks like inline math.
const EXPORT_FIT_CSS =
  ".milkdown table { width: 100%; } " +
  ".math-block-rendered, .katex-display { overflow: visible; } " +
  ".katex-display > .katex { white-space: normal; } " +
  ".milkdown a, .milkdown p, .milkdown li, .milkdown td, .milkdown th { overflow-wrap: anywhere; } ";

// Theme + page CSS for the offscreen PDF render. `whitePage` prints on white
// (with the theme's light form). With a known page geometry the sheet margin
// is zero so the page colour bleeds to the edges, and paginate.ts lays margins out.
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
    // Only `auto` leaves Linux margins to the GTK page setup: given a CSS
    // margin, WebKitGTK cut pages taller and lost each page's last lines.
    `@page { margin: ${page ? "0" : "auto"}; } ` +
    `html, body { margin: 0; background: ${background}; } ` +
    ".app-shell, .main-pane, .editor-scroll { height: auto; overflow: visible; background: transparent; } " +
    `.editor-content, .editor-content.typewriter-active { max-width: none; padding: ${page ? page.margin : 0}px ${side}px 0; } ` +
    (page
      ? ""
      : "pre, blockquote, table, img, .math-block-wrapper, .mermaid-preview, .md-alert { break-inside: avoid; } " +
        // WebKitGTK's print-to-file ignores break-inside and cut display
        // formulas at the seam; it never splits an inline-block.
        ".math-block-wrapper, .mermaid-preview { display: inline-block; width: 100%; } ") +
    EXPORT_FIT_CSS
  );
}

/** The sheet geometry this platform's native renderer lays out, if known. */
function platformPage(): PageGeometry | null {
  if (isMac) return MAC_PAGE;
  if (isWindowsPlatform()) return WINDOWS_PAGE;
  return null;
}

const HTML_LAYOUT_CSS =
  ".app-shell, .main-pane, .editor-scroll { height: auto; overflow: visible; } " +
  ".editor-content { padding: 2rem 1.5rem; } " +
  EXPORT_FIT_CSS;

function showPdfOverlay(t: Strings): HTMLElement {
  const el = document.createElement("div");
  el.className = "pdf-export-overlay";
  el.innerHTML = `<div class="pdf-export-card"><div class="pdf-export-spinner" aria-hidden="true"></div><div class="pdf-export-text">${escapeHtml(t.pdfPreparing)}</div></div>`;
  document.body.appendChild(el);
  return el;
}

// Draws everything still pending first, since the export copies the page as
// it is: formulas waiting for KaTeX, and blocks waiting to come on screen.
async function drawPending(editor: Element): Promise<void> {
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

// Lets web fonts and images settle before serializing.
async function settleRender(editor: Element): Promise<void> {
  await drawPending(editor);
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

// File > Export as PDF. Needs the WYSIWYG view; unsaved edits included.
export async function exportPdf(
  tab: DocTab,
  t: Strings,
  { pageNumbers = false, lightColors = false } = {},
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
    // macOS keeps the theme's page colour unless asked for light colours.
    const whitePage = !isMac || lightColors;
    const unmark = await markDrawnPictures(
      editor,
      whitePage || !appearanceIsDark() ? "light" : "dark",
    );
    const copy = cloneEditorContent(
      editor,
      "inline",
      await linkRenderer(editor),
    );
    unmark();
    let content = await inlineImages(copy, tab.path);
    if (whitePage && appearanceIsDark()) {
      const style = getComputedStyle(editor);
      content = await lightDiagrams(
        content,
        editor.clientWidth - 40,
        style.fontFamily,
      );
    }
    const finished = await finishExportPage({
      format: "pdf",
      path: tab.path,
      html: content,
    });
    const page = platformPage();
    const standalone = buildStandaloneHtml(
      base,
      finished.html,
      pdfLayoutCss(page, whitePage) + finished.css,
      whitePage,
    );
    const html = page ? await paginateHtml(standalone, page) : standalone;
    await exportDoc.exportPdfNative({
      html,
      // Resolves relative image srcs (assets/...) against the document folder.
      baseDir: tab.path ? dirname(tab.path) : null,
      outputPath: picked,
      pageNumbers,
    });
    void exportDoc.revealInDir(picked);
  } catch (err) {
    // Off before the message: the overlay sits above the app's dialogs.
    overlay.remove();
    await showMessage(`${t.pdfFailed} ${explainError(err, t)}`, {
      title: t.exportFailedTitle,
      tone: "error",
    });
  } finally {
    overlay.remove();
  }
}

// Saved next to the document, relative image paths are kept as-is, like
// Typora; anywhere else the pictures go inside the page.
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
  await drawPending(editor);
  const besideDocument = !!tab.path && dirname(tab.path) === dirname(picked);
  const renderLink = await linkRenderer(editor);
  const unmark = await markDrawnPictures(
    editor,
    appearanceIsDark() ? "dark" : "light",
  );
  const copy = cloneEditorContent(
    editor,
    besideDocument ? "document" : "inline",
    renderLink,
  );
  unmark();
  const content = besideDocument ? copy : await inlineImages(copy, tab.path);
  const finished = await finishExportPage({
    format: "html",
    path: tab.path,
    html: content,
  });
  const html = buildStandaloneHtml(
    base,
    finished.html,
    HTML_LAYOUT_CSS + finished.css,
  );
  await fs.writeTextFile(picked, html);
  void exportDoc.revealInDir(picked);
}

// The drawn blocks' pictures in the active editor, for a pandoc export.
async function drawnPictures(): Promise<Map<string, (string | null)[]>> {
  const editor = document.querySelector('[data-active-tab="true"] .milkdown');
  if (!editor) return new Map();
  await drawPending(editor);
  return drawnPicturesByLanguage(editor, "light");
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
    // Guide the user to install pandoc rather than bundle the GPL binary.
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
        ? await drawnBlocksToImages(
            await diagramsToImages(text, diagramEngine),
            await drawnPictures(),
          )
        : text,
      outputPath: picked,
      format,
      resourceDir: tab.path ? dirname(tab.path) : null,
      title: base,
    });
    void exportDoc.revealInDir(picked);
  } catch (err) {
    await showMessage(`${t.exportFailed} ${explainError(err, t)}`, {
      title: t.exportFailedTitle,
      tone: "error",
    });
  }
}
