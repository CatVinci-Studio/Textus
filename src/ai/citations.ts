import type { WebSource } from "./types";

/**
 * Web citations in text Textus AI proposes: the model marks a web fact with
 * its source's number as a link, `[2](https://…)`. On accept they become
 * footnotes or are left out, per settings.sourcesAsFootnotes.
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

/** One page, one footnote: an address without its fragment or trailing slash. */
function samePage(url: string): string {
  return url.split("#")[0].replace(/\/+$/, "");
}

/** A web address's site, as a person names it: "nature.com". */
export function siteOf(url: string): string {
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
 * The text with each citation as a footnote reference, plus the definitions
 * they need: one per page, numbered on from the document's own, titled from
 * the conversation's sources.
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
