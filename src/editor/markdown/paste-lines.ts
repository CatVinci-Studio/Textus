/**
 * Pasted text as the writer saw it: its lines kept, and a quote's bars
 * made a quote. Pasted text is read as Markdown, where a line break inside
 * a paragraph is only a space - an email or a chat message pasted in came
 * in as one long line. So a line followed by another line of the same
 * paragraph keeps its break (a hard break); blocks are left as Markdown
 * reads them - fences, tables, lists, headings, quotes, indented code.
 *
 * Text copied from a terminal or a chat app's quote often carries the bar
 * it was drawn with ("▎ Hi Denisse,"): when every line that has text
 * starts with one, the bars go and the text is a quote.
 */

/** The bars a copied quote is drawn with, at a line's start. */
const QUOTE_BAR = /^[ \t]*[▎▍▌▋▊▉│┃║|][ \t]?/;

/** A line that starts a block of its own, or belongs to one. */
const BLOCK_LINE =
  /^(?: {4}|\t|[ \t]*(?:#{1,6}(?:\s|$)|[-*+](?:\s|$)|\d+[.)](?:\s|$)|>|\||```|~~~|\$\$|<|---+\s*$|\*\*\*+\s*$|___+\s*$|={3,}\s*$|-{3,}\s*$))/;

/** Whether every line with text starts with a quote bar. */
function quotedWithBars(lines: string[]): boolean {
  const filled = lines.filter((line) => line.trim() !== "");
  return (
    filled.length > 1 &&
    filled.every(
      (line) => QUOTE_BAR.test(line) && !/^[ \t]*\|.*\|\s*$/.test(line),
    )
  );
}

/** `text` with its quote bars made Markdown quotes, and the line breaks
 *  inside its paragraphs kept. */
export function keepPastedLines(text: string): string {
  let lines = text.replace(/\r\n?/g, "\n").split("\n");
  const quote = quotedWithBars(lines);
  if (quote) lines = lines.map((line) => line.replace(QUOTE_BAR, ""));
  let fence: string | null = null;
  const out = lines.map((line, i) => {
    const marker = /^[ \t]*(```|~~~|\$\$)/.exec(line)?.[1];
    if (fence) {
      if (marker === fence) fence = null;
      return line;
    }
    if (marker) {
      fence = marker;
      return line;
    }
    const next = lines[i + 1];
    const breaks =
      next !== undefined &&
      line.trim() !== "" &&
      next.trim() !== "" &&
      !BLOCK_LINE.test(line) &&
      !BLOCK_LINE.test(next) &&
      !/(?: {2}|\\)$/.test(line);
    return breaks ? `${line}\\` : line;
  });
  return out.map((line) => (quote ? `> ${line}`.trimEnd() : line)).join("\n");
}
