import { headingsOf } from "../utils/markdown-lines";
import { headingSlug, numberRepeats } from "../editor/markdown/link-target";

interface HeadingInfo {
  level: number;
  text: string;
}

/** The document's headings as the editor counts them (headingsOf), so
 *  the Outline's n-th row is the editor's n-th heading. */
export function parseHeadings(markdown: string): HeadingInfo[] {
  return headingsOf(markdown).map(({ level, text }) => ({ level, text }));
}

/** A heading's source as it reads in the document: inline code, emphasis
 *  and link syntax dropped, so "`text-spacing`" shows as text-spacing. */
export function headingLabel(text: string): string {
  // Code and maths are set aside first: marks inside them are their text.
  const kept: string[] = [];
  const keep = (s: string) => `\uE000${kept.push(s) - 1}\uE000`;
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]+)`+/g, (_, code: string) => keep(code))
    .replace(/\$+[^$]+\$+/g, keep)
    .replace(/(\*\*|~~|==)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, "$1")
    // Underscores mark emphasis only at a word's edge (snake_case stays).
    .replace(/(?<![\p{L}\p{N}_])(__?)(?=\S)(.+?)(?<=\S)\1(?![\p{L}\p{N}_])/gu, "$2")
    .replace(/\uE000(\d+)\uE000/g, (_, i: string) => kept[Number(i)]);
}

/** The anchors the editor gives these headings, read from their source
 *  (math slugged by its text, as the editor does): for a tab not drawn. */
export function sourceAnchors(texts: string[]): string[] {
  const shown = (text: string) =>
    headingLabel(text).replace(/\$+([^$]+)\$+/g, "$1");
  return numberRepeats(texts.map((text) => headingSlug(shown(text))));
}
