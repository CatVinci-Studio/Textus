import type { Outline, SourceEntry } from "../../platform/bindings/ai-paper";

/** The sources a paper may cite, as its reference list gives them. */
export interface PaperSources {
  heading: string;
  sources: SourceEntry[];
}

/** A citation as a writer writes it, `[n](address)`: a web page's address
 *  or a file of the reference library. Rust's `cited_link`. */
const CITED = /\[(\d{1,3})\]\(((?:https?:\/\/|references\/)[^)\s]+)\)/g;

/** The research's numbers of the sources `texts` cite, given 1, 2, … in
 *  the order they are first cited; numbers not in `known` are left out. */
export function citationOrder(
  texts: string[],
  known: ReadonlySet<number>,
): Map<number, number> {
  const order = new Map<number, number>();
  for (const text of texts)
    for (const [, n] of text.matchAll(CITED)) {
      const source = Number(n);
      if (known.has(source) && !order.has(source))
        order.set(source, order.size + 1);
    }
  return order;
}

/** `markdown` with each citation as the finished paper has it: its number
 *  in `order`, linked to its entry in the reference list (`#ref-k`), the
 *  brackets escaped so they stay text; inside a code block a bare `[k]`,
 *  since a chart's JSON can't hold a backslash. Rust's `plain_citations`. */
export function numberedCitations(
  markdown: string,
  order: ReadonlyMap<number, number>,
): string {
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      return line.replace(CITED, (whole, n: string) => {
        const k = order.get(Number(n));
        if (!k) return whole;
        return inFence ? `[${k}]` : `[\\[${k}\\]](#ref-${k})`;
      });
    })
    .join("\n");
}

/** A section's text as it goes in the paper: the heading a kept section
 *  carries left off (the paper gives it one), and a code block, chart or
 *  figure mark still being written closed, so it doesn't take in the
 *  sections after it. */
export function sectionBody(text: string): string {
  let body = text.replace(/^##[^\n]*\n+/, "").trim();
  const comment = body.lastIndexOf("<!--");
  if (comment > body.lastIndexOf("-->")) body = body.slice(0, comment).trim();
  const fences = body.match(/^\s*```/gm)?.length ?? 0;
  if (fences % 2 === 1) body += "\n```";
  return body;
}

/** The paper as it stands while its sections are written: the topic as its
 *  title, then every section of the outline under its heading, with what
 *  its writer has written so far, and once its sources are known its
 *  citations numbered as the finished paper numbers them, listed below. */
export function paperDraft(
  topic: string,
  outline: Outline,
  sectionText: Record<number, string>,
  sources: PaperSources | null = null,
): string {
  const parts = [`# ${topic}`];
  outline.sections.forEach((section, i) => {
    const body = sectionBody(sectionText[i] ?? "");
    parts.push(body ? `## ${section.title}\n\n${body}` : `## ${section.title}`);
  });
  if (!sources) return parts.join("\n\n");
  const order = citationOrder(parts, new Set(sources.sources.map((s) => s.n)));
  const body = numberedCitations(parts.join("\n\n"), order);
  if (order.size === 0) return body;
  const entries = sources.sources
    .filter((s) => order.has(s.n))
    .sort((a, b) => order.get(a.n)! - order.get(b.n)!)
    .map((s) => `\\[${order.get(s.n)}\\] ${s.entry}`);
  return `${body}\n\n## ${sources.heading}\n\n${entries.join("\n\n")}`;
}

const PICTURE_LINE =
  /^[ \t]*!\[[^\]\n]*\]\(textus-generated:[0-9a-z]+[^)\n]*\)[ \t]*\n?/gm;

/** The finished paper without its pictures: what is written first; the
 *  pictures follow once they are made. */
export function withoutPictures(markdown: string): string {
  return markdown.replace(PICTURE_LINE, "").replace(/\n{3,}/g, "\n\n");
}
