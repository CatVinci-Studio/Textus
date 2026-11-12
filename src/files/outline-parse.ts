import { headingsOf } from "../utils/markdown-lines";
interface HeadingInfo {
  level: number;
  text: string;
}

/** The document's headings as the editor counts them (headingsOf), so
 *  the Outline's n-th row is the editor's n-th heading. */
export function parseHeadings(markdown: string): HeadingInfo[] {
  return headingsOf(markdown).map(({ level, text }) => ({ level, text }));
}
