import { headingsOf } from "../utils/markdown-headings";
import { plainInline } from "../utils/markdown-plain";
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

/** The anchors the editor gives these headings, read from their source
 *  (math slugged by its text, as the editor does): for a tab not drawn. */
export function sourceAnchors(texts: string[]): string[] {
  const shown = (text: string) =>
    plainInline(text).replace(/\$+([^$]+)\$+/g, "$1");
  return numberRepeats(texts.map((text) => headingSlug(shown(text))));
}
