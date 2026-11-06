// Settings › Export › Numbered headings, numbered as the Heading Numbers
// plugin numbers them (catvinci.heading-numbers, `startOf`): from the
// highest level, or the next one down when that level holds one heading,
// the title, which stays unnumbered. Pandoc numbers from level 1, so the
// numbered levels move up to start there.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?=[ \t]|$)/;

/** The level numbering starts at, and the title's line if one is left out. */
function numberingStart(levels: { line: number; level: number }[]) {
  const top = Math.min(...levels.map((h) => h.level));
  const atTop = levels.filter((h) => h.level === top);
  const below = levels.filter((h) => h.level > top);
  return atTop.length === 1 && below.length
    ? { start: Math.min(...below.map((h) => h.level)), title: atTop[0].line }
    : { start: top, title: -1 };
}

/** `markdown` with its headings set for `--number-sections`. */
export function numberedHeadings(markdown: string): string {
  const lines = markdown.split("\n");
  const headings: { line: number; level: number }[] = [];
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const f = FENCE.exec(line);
    if (f && (!fence || (f[1][0] === fence[0] && f[1].length >= fence.length)))
      fence = fence ? null : f[1];
    else if (!fence) {
      const h = HEADING.exec(line);
      if (h) headings.push({ line: i, level: h[1].length });
    }
  });
  if (!headings.length) return markdown;
  const { start, title } = numberingStart(headings);
  for (const { line, level } of headings) {
    const text = lines[line].replace(HEADING, "");
    lines[line] =
      line === title
        ? `#${text.replace(/[ \t#]*$/, "")} {.unnumbered .unlisted}`
        : `${"#".repeat(level - start + 1)}${text}`;
  }
  return lines.join("\n");
}
