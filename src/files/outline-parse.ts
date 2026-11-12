import { eachLine } from "../utils/markdown-lines";
interface HeadingInfo {
  level: number;
  text: string;
}

/**
 * Parses ATX headings (# ... ######) out of raw markdown, skipping
 * fenced code blocks so a shell comment like `# foo` isn't mistaken
 * for a heading. As in CommonMark, a fence closes only on a run of the
 * same character at least as long as the one that opened it, with
 * nothing after it.
 */
export function parseHeadings(markdown: string): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  eachLine(
    markdown,
    (line, _index, code) => {
      if (code) return;
      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (match) headings.push({ level: match[1].length, text: match[2] });
    },
    { frontMatter: true },
  );
  return headings;
}
