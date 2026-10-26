/**
 * A last step an HTML or PDF export takes, given by the window shell: the
 * plugins listening (textus.export.onWillExport) may add CSS to the page
 * or change its HTML. Without one, the page is as the editor made it.
 */
export interface ExportPage {
  format: "html" | "pdf";
  /** The document's file; null for a draft. */
  path: string | null;
  /** The page's content: the editor's copy, pictures in place. */
  html: string;
}

export type ExportStep = (
  page: ExportPage,
) => Promise<{ html: string; css: string }>;

let current: ExportStep | null = null;

export function setExportStep(step: ExportStep | null): void {
  current = step;
}

/** The page after the step: its HTML, and CSS to add to the page's own.
 *  HTML the step changed loses whatever could run (scripts, handlers,
 *  frames): the page is opened elsewhere, and a PDF is drawn by the app. */
export async function finishExportPage(
  page: ExportPage,
): Promise<{ html: string; css: string }> {
  if (!current) return { html: page.html, css: "" };
  const done = await current(page);
  if (done.html === page.html) return done;
  const { default: DOMPurify } = await import("dompurify");
  return {
    html: DOMPurify.sanitize(done.html, { FORBID_TAGS: ["style"] }),
    css: done.css,
  };
}
