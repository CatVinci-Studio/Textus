import { headingsOf } from "../utils/markdown-headings";
// Settings › Export › Numbered headings, numbered as the Heading Numbers
// plugin numbers them (catvinci.heading-numbers, `startOf`): from the
// highest level, or the next one down when that level holds one heading,
// the title, which stays unnumbered. Pandoc numbers from level 1, so the
// numbered levels move up to start there. The headings are the editor's
// (headingsOf), which Pandoc's CommonMark reader reads the same way.

const ATX = /^ {0,3}#{1,6}(?=[ \t]|$)/;

/** The level numbering starts at, and the title's line if one is left out. */
function numberingStart(levels: { line: number; level: number }[]) {
  const top = Math.min(...levels.map((h) => h.level));
  const atTop = levels.filter((h) => h.level === top);
  const below = levels.filter((h) => h.level > top);
  return atTop.length === 1 && below.length
    ? { start: Math.min(...below.map((h) => h.level)), title: atTop[0].line }
    : { start: top, title: -1 };
}

/** `markdown` with its headings set for `--number-sections`. A setext
 *  heading is written as ATX, the one form that holds every level. */
export function numberedHeadings(markdown: string): string {
  const lines = markdown.split("\n");
  const headings = headingsOf(markdown);
  if (!headings.length) return markdown;
  const { start, title } = numberingStart(headings);
  // From the end, so a setext heading's lines folding into one moves no
  // heading still to come.
  for (const { line, end, level, text } of [...headings].reverse()) {
    const words =
      line === end
        ? lines[line].replace(ATX, "")
        : ` ${text.replace(/\n/g, " ")}`;
    const heading =
      line === title
        ? `#${words.replace(/(?:[ \t]+#+)?[ \t]*$/, "")} {.unnumbered .unlisted}`
        : `${"#".repeat(level - start + 1)}${words}`;
    lines.splice(line, end - line + 1, heading);
  }
  return lines.join("\n");
}
