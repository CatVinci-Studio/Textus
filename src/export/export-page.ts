import type { DocTab } from "../document/doc-tabs";
import { katexLoaded, loadKatex } from "../editor/math/katex-loader";
import { drawEverything } from "../editor/draw-when-visible";
import { resolveNoteLinks } from "./note-links";
import { lightDiagrams } from "./diagram-images";
import { markDrawnPictures } from "./drawn-blocks";
import { finishExportPage } from "./export-step";
import {
  WIKILINK_SELECTOR,
  cloneEditorContent,
  inlineImages,
  linkRenderer,
  nextFrame,
  type ExportImages,
} from "./standalone-html";

/**
 * The page an HTML or PDF export writes: the editor's document as drawn,
 * copied with its links resolved and its pictures in place, then through
 * the plugins' export step. The two exports differ only in the options.
 */

// Draws everything still pending first, since the export copies the page as
// it is: formulas waiting for KaTeX, and blocks waiting to come on screen.
export async function drawPending(editor: Element): Promise<void> {
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

/** Where the editor's wikilinks lead, for a page saved as `from`. */
function pageNoteLinks(editor: Element, tab: DocTab, from: string) {
  const sources = [...editor.querySelectorAll(WIKILINK_SELECTOR)].map(
    (el) => el.textContent ?? "",
  );
  return resolveNoteLinks(sources, tab.path, from);
}

/** The document in `editor` as an export's page (and its added CSS). */
export async function preparePage(
  editor: Element,
  tab: DocTab,
  options: {
    format: "html" | "pdf";
    /** Where the page is read from: its links lead from there. */
    from: string;
    images: ExportImages;
    /** The theme drawn pictures (diagrams, charts) are copied in. */
    drawn: "light" | "dark";
    /** Fonts and pictures settled first (a printed page), not only drawn. */
    settle: boolean;
    /** A white page under a dark theme: diagrams redrawn light, at this
     *  width and font. */
    light?: { width: number; font: string };
  },
): Promise<{ html: string; css: string }> {
  await (options.settle ? settleRender(editor) : drawPending(editor));
  const renderLink = await linkRenderer(editor);
  const noteLinks = await pageNoteLinks(editor, tab, options.from);
  const unmark = await markDrawnPictures(editor, options.drawn);
  let copy: string;
  try {
    copy = cloneEditorContent(editor, options.images, renderLink, noteLinks);
  } finally {
    unmark();
  }
  let html =
    options.images === "inline" ? await inlineImages(copy, tab.path) : copy;
  if (options.light)
    html = await lightDiagrams(html, options.light.width, options.light.font);
  return finishExportPage({ format: options.format, path: tab.path, html });
}
