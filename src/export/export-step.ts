/**
 * A last step an HTML or PDF export takes: onWillExport plugins may add CSS
 * or change the HTML.
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

/** The page after the step. HTML the step changed loses whatever could run,
 *  since the page is opened elsewhere. */
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
