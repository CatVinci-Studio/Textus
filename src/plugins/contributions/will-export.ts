import { setExportStep, type ExportPage } from "../../export/export-step";

/**
 * textus.export.onWillExport: plugins that add CSS to an HTML or PDF
 * export's page, or change its HTML (numbered headings, a footer). The
 * export asks each in turn (export/export-step.ts) and waits at most two
 * seconds for each: a slow or broken plugin never holds an export up.
 */
type Answer = { html?: string | null; css?: string | null } | null;
type Ask = (page: ExportPage) => Promise<Answer>;

const listeners = new Map<string, Ask>();

/** How long an export waits for one plugin. */
export const WILL_EXPORT_MS = 2000;

export function setWillExport(plugin: string, on: boolean, ask: Ask): void {
  if (on) listeners.set(plugin, ask);
  else listeners.delete(plugin);
}

export function forgetWillExport(plugin: string): void {
  listeners.delete(plugin);
}

/** The page as each listening plugin left it, in turn. */
async function runWillExport(
  page: ExportPage,
): Promise<{ html: string; css: string }> {
  let html = page.html;
  let css = "";
  for (const ask of listeners.values()) {
    const answer = await Promise.race([
      ask({ ...page, html }).catch(() => null),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), WILL_EXPORT_MS),
      ),
    ]);
    if (typeof answer?.html === "string") html = answer.html;
    if (typeof answer?.css === "string") css += `\n${answer.css}`;
  }
  return { html, css };
}

setExportStep((page) =>
  listeners.size
    ? runWillExport(page)
    : Promise.resolve({ html: page.html, css: "" }),
);
