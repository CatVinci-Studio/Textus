export interface HeadingInfo {
  level: number;
  text: string;
}

/** Blockquote and list markers a fence may sit behind, as in `2. ```` or
 *  `> ~~~`; they are stripped before looking for the fence itself. */
const CONTAINER_PREFIX =
  /^(?:[ \t]*(?:>|[-+*]|\d{1,9}[.)])(?=[ \t]|$)[ \t]?)*[ \t]*/;
const FENCE = /^(`{3,}|~{3,})(.*)$/;

/**
 * Parses ATX headings (# ... ######) out of raw markdown, skipping
 * fenced code blocks so a shell comment like `# foo` isn't mistaken
 * for a heading. As in CommonMark, a fence closes only on a run of the
 * same character at least as long as the one that opened it, with
 * nothing after it.
 */
export function parseHeadings(markdown: string): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  let fence: string | null = null;

  for (const line of markdown.split("\n")) {
    const fenceMatch = FENCE.exec(line.replace(CONTAINER_PREFIX, ""));
    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence[0] &&
        fenceMatch[1].length >= fence.length &&
        fenceMatch[2].trim() === ""
      ) {
        fence = null;
      }
      continue;
    }
    // A backtick fence's info string can't hold a backtick: ```a``` is code.
    if (
      fenceMatch &&
      !(fenceMatch[1][0] === "`" && fenceMatch[2].includes("`"))
    ) {
      fence = fenceMatch[1];
      continue;
    }

    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      headings.push({ level: match[1].length, text: match[2] });
    }
  }

  return headings;
}
