import { fill } from "../i18n/fill";
import { tabElement } from "../engine/layout/tab-element";
import { escapeHtml } from "../utils/html";
import { showConfirm, showMessage } from "../engine/controls/app-dialog";
import type { Strings } from "../i18n/strings";
import { basename, dirname } from "../utils/path";
import { tabTitle, type DocTab } from "../document/doc-tabs";
import { exportDoc, fs } from "../platform/ipc";
import { isMacPlatform, isWindowsPlatform } from "../platform/os";
import { canExportPdf, canExportWithPandoc } from "../platform/capabilities";
import { toPandocMarkdown } from "./pandoc-markdown";
import { numberedHeadings } from "./pandoc-headings";
import { pandocOptions, type PandocSettings } from "./pandoc-options";
import { noteLinkSources, resolveNoteLinks } from "./note-links";
import { drawPending, preparePage } from "./export-page";
import { diagramsToImages, drawnBlocksToImages } from "./diagram-images";
import { drawnPicturesByLanguage } from "./drawn-blocks";
import { appearanceIsDark } from "../editor/diagram-engine";
import type { DiagramEngine } from "../prefs/SettingsContext";
import {
  MAC_PAGE,
  WINDOWS_PAGE,
  paginateHtml,
  type PageGeometry,
} from "./paginate";
import { buildStandaloneHtml, nextFrame } from "./standalone-html";
// eslint-disable-next-line no-restricted-syntax -- a lazy chunk's entry passes these on
export {
  type ExportImages,
  cloneEditorContent,
  buildStandaloneHtml,
} from "./standalone-html";
import { explainError } from "../utils/error-explain";
import { pandocFormat } from "../registry/export-formats";
// File > Export: HTML serializes the live editor DOM, PDF prints a themed
// render, everything else converts through a user-installed pandoc.

function exportBaseName(tab: DocTab, t: Strings): string {
  return tab.path
    ? basename(tab.path).replace(/\.[^.]+$/, "")
    : tabTitle(tab, t);
}

// Standalone HTML (HTML and PDF export): the live editor DOM with every
// stylesheet inlined and the app root's theme attributes mirrored.

const isMac = isMacPlatform();

// Content too wide for a page wraps or shrinks instead of being clipped. A
// page can't scroll, so display math breaks like inline math, and a diagram
// drawn wider than the column shrinks to it, its height with it.
const EXPORT_FIT_CSS =
  ".milkdown table { width: 100%; } " +
  ".mermaid-preview { overflow: visible; } " +
  ".mermaid-preview > svg { min-width: 0; height: auto; } " +
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
  const background = whitePage ? "#fff" : "var(--doc-bg, var(--ui-bg))";
  return (
    ":root { -webkit-print-color-adjust: exact; print-color-adjust: exact; } " +
    // Whatever paints with the page colour (sticky bars, cut-outs) matches.
    (whitePage ? ":root { --doc-bg: #fff !important; } " : "") +
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
  el.className = "tx-backdrop pdf-export-overlay";
  el.innerHTML = `<div class="pdf-export-card"><div class="pdf-export-spinner" aria-hidden="true"></div><div class="pdf-export-text">${escapeHtml(t.pdfPreparing)}</div></div>`;
  document.body.appendChild(el);
  return el;
}

// File > Export as PDF. Needs the WYSIWYG view; unsaved edits included.
export async function exportPdf(
  tab: DocTab,
  t: Strings,
  { pageNumbers = false, lightColors = false } = {},
): Promise<void> {
  if (!canExportPdf) return;
  const editor = editorOf(tab);
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
    // macOS keeps the theme's page colour unless asked for light colours.
    const whitePage = !isMac || lightColors;
    const style = getComputedStyle(editor);
    const finished = await preparePage(editor, tab, {
      format: "pdf",
      // The page renders from the document's folder; a link's href too.
      from: tab.path ?? picked,
      images: "inline",
      drawn: whitePage || !appearanceIsDark() ? "light" : "dark",
      settle: true,
      light:
        whitePage && appearanceIsDark()
          ? { width: editor.clientWidth - 40, font: style.fontFamily }
          : undefined,
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

/** The editor of the document being exported: its own, whatever tab is in
 *  front (an AI or Settings tab may be). */
function editorOf(tab: DocTab): Element | null {
  return tabElement(tab.id)?.querySelector(".milkdown") ?? null;
}

// Saved next to the document, relative image paths are kept as-is, like
// Typora; anywhere else the pictures go inside the page.
export async function exportHtml(tab: DocTab, t: Strings): Promise<void> {
  const editor = editorOf(tab);
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
  try {
    const besideDocument = !!tab.path && dirname(tab.path) === dirname(picked);
    const finished = await preparePage(editor, tab, {
      format: "html",
      from: picked,
      images: besideDocument ? "document" : "inline",
      drawn: appearanceIsDark() ? "dark" : "light",
      settle: false,
    });
    const html = buildStandaloneHtml(
      base,
      finished.html,
      HTML_LAYOUT_CSS + finished.css,
    );
    await fs.writeTextFile(picked, html);
    void exportDoc.revealInDir(picked);
  } catch (err) {
    await showMessage(explainError(err, t), {
      title: t.exportFailedTitle,
      tone: "error",
    });
  }
}

// The drawn blocks' pictures in the document's editor, for a pandoc export.
async function drawnPictures(
  tab: DocTab,
): Promise<Map<string, (string | null)[]>> {
  const editor = editorOf(tab);
  if (!editor) return new Map();
  await drawPending(editor);
  return drawnPicturesByLanguage(editor, "light");
}

// The menu's place a failed Pandoc export points to.
function pandocErrorText(err: unknown, t: Strings): string {
  const where = fill(t.pandocErrorSettings, {
    page: t.navEditing,
    group: t.menuExport,
  });
  return `${t.exportFailed} ${explainError(err, t)}\n\n${where}`;
}

export async function exportViaPandoc(
  tab: DocTab,
  format: string,
  t: Strings,
  diagramEngine: DiagramEngine,
  settings: PandocSettings,
): Promise<void> {
  const info = pandocFormat(format);
  if (!info || !canExportWithPandoc) return;
  const pandoc = await exportDoc.detectPandoc();
  if (!pandoc) {
    // Guide the user to install pandoc rather than bundle the GPL binary.
    const goInstall = await showConfirm(t.pandocMissingMessage, {
      title: t.pandocMissingTitle,
      okLabel: t.pandocMissingDownload,
      cancelLabel: t.cancel,
    });
    if (goInstall) void exportDoc.openPandocInstallPage();
    return;
  }
  const base = exportBaseName(tab, t);
  const picked = await exportDoc.exportSaveDialog(
    `${base}.${info.ext}`,
    info.name,
    info.ext,
  );
  if (!picked) return;
  try {
    const options = pandocOptions(settings, format);
    // tab.content, not the file on disk - unsaved edits export too.
    const source = options.numberSections
      ? numberedHeadings(tab.content)
      : tab.content;
    const text = toPandocMarkdown(source, {
      alertLabels: {
        NOTE: t.alertNote,
        TIP: t.alertTip,
        IMPORTANT: t.alertImportant,
        WARNING: t.alertWarning,
        CAUTION: t.alertCaution,
      },
      noteLinks: await resolveNoteLinks(
        noteLinkSources(source),
        tab.path,
        picked,
      ),
      citations: !!options.bibliography,
    });
    await exportDoc.exportViaPandoc({
      pandocPath: pandoc,
      markdown: info.embedsImages
        ? await drawnBlocksToImages(
            await diagramsToImages(text, diagramEngine),
            await drawnPictures(tab),
          )
        : text,
      outputPath: picked,
      format,
      resourceDir: tab.path ? dirname(tab.path) : null,
      title: base,
      referenceDoc:
        format === "docx" && settings.docxReferenceDoc
          ? settings.docxReferenceDoc
          : null,
      options,
    });
    void exportDoc.revealInDir(picked);
  } catch (err) {
    await showMessage(pandocErrorText(err, t), {
      title: t.exportFailedTitle,
      tone: "error",
    });
  }
}
