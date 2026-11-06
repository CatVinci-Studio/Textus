import { setExportStep, type ExportPage } from "../../export/export-step";
import { inIdOrder } from "./will-save";

/**
 * Plugins that add CSS to an HTML or PDF export or change its HTML. Each is
 * asked in turn, in plugin id order, given the HTML as the one before left
 * it and at most two seconds, so none holds an export up.
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
  for (const [, ask] of inIdOrder(listeners)) {
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
