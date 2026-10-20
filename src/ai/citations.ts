import type { WebSource } from "./types";

/**
 * Web citations in text Textus AI proposes for the document. The model
 * marks a fact taken from the web with its source's number as a link to the
 * page - `[2](https://…)` (src-tauri ai/web/mod.rs asks for exactly that) -
 * so a proposal says which page backs what without the chat around it. On
 * accepting, they become Markdown footnotes or are left out, as the card's
 * "Add sources as footnotes" says (settings.sourcesAsFootnotes).
 */
const CITATION = /[ \t]?\[(\d{1,3})\]\((https?:\/\/[^)\s]+)\)/g;

export function hasCitations(text: string): boolean {
  CITATION.lastIndex = 0;
  return CITATION.test(text);
}

/** The text with its citations left out. */
export function withoutCitations(text: string): string {
  return text.replace(CITATION, "");
}

/** One page, one footnote: an address without its fragment or trailing
 *  slash (as ai/web/sources.rs's same_page). */
function samePage(url: string): string {
  return url.split("#")[0].replace(/\/+$/, "");
}

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The footnote labels a document already uses, `[^1]` and `[^note]`. */
export function footnoteLabels(markdown: string): Set<string> {
  return new Set([...markdown.matchAll(/\[\^([^\]\s]+)\]/g)].map((m) => m[1]));
}

/**
 * The text with each citation as a footnote reference, and the footnote
 * definitions they need - one per page, numbered on from the document's
 * own footnotes, titled from the conversation's sources where the page is
 * one of them.
 */
export function citationsAsFootnotes(
  text: string,
  sources: WebSource[],
  usedLabels: Set<string>,
): { text: string; definitions: string[] } {
  let next =
    Math.max(
      0,
      ...[...usedLabels].map((l) => Number(l)).filter(Number.isInteger),
    ) + 1;
  const labels = new Map<string, string>();
  const definitions: string[] = [];
  const out = text.replace(CITATION, (_match, _n: string, url: string) => {
    const page = samePage(url);
    let label = labels.get(page);
    if (!label) {
      while (usedLabels.has(String(next))) next++;
      label = String(next++);
      labels.set(page, label);
      const title =
        sources.find((s) => samePage(s.url) === page)?.title || siteOf(url);
      definitions.push(`[^${label}]: [${title.replace(/[[\]]/g, "")}](${url})`);
    }
    return `[^${label}]`;
  });
  return { text: out, definitions };
}
