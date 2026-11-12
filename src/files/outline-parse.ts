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
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]+)`+/g, "$1")
    .replace(/(\*\*|__|~~|==)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/([*_])(?=\S)(.+?)(?<=\S)\1/g, "$2");
}

/** The anchors the editor gives these headings, read from their source
 *  (math slugged by its text, as the editor does): for a tab not drawn. */
export function sourceAnchors(texts: string[]): string[] {
  const shown = (text: string) =>
    headingLabel(text).replace(/\$+([^$]+)\$+/g, "$1");
  return numberRepeats(texts.map((text) => headingSlug(shown(text))));
}
