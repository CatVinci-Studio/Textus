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
 *
 * Two kinds of text break lines that were not the writer's (1.2.2): a PDF
 * and a terminal wrap a paragraph at their width, so a line that runs to
 * that width and stops mid-sentence joins the next one again - with no
 * space between CJK - and a PDF's ligatures (ﬁ) and radicals (⼀ for 一)
 * become the letters they stand for. And a terminal's output - a prompt,
 * columns lined up with spaces - is a code block, its spacing kept.
 * Fenced code is pasted as it is: rejoined, its lines ran together.
 */

/** The bars a copied quote is drawn with, at a line's start. */
const QUOTE_BAR = /^[ \t]*[▎▍▌▋▊▉│┃║|][ \t]?/;

/** A line that starts a block of its own, or belongs to one. */
const BLOCK_LINE =
  /^(?: {4}|\t|[ \t]*(?:#{1,6}(?:\s|$)|[-*+](?:\s|$)|\d+[.)](?:\s|$)|>|\||```|~~~|\$\$|<|---+\s*$|\*\*\*+\s*$|___+\s*$|={3,}\s*$|-{3,}\s*$))/;

/** A shell's prompt at a line's start: `$ `, `% `, `PS C:\…> `. */
const PROMPT = /^(?:[$%] \S|PS [A-Za-z]:\\[^>]*> )/;

/** Columns lined up with spaces: two gaps of two or more inside a line -
 *  not after a full stop, where some typists put two. */
const COLUMNS = /[^\s.!?] {2,}\S.*[^\s.!?] {2,}\S/;

/** Where a sentence or a clause ends. */
const ENDS_CLAUSE = /[.!?:;。！？：；…)"'”’」』）\]]$/;

const CJK = /[\u2e80-\u9fff\uf900-\ufaff]/;

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

/** Whether `lines` are a terminal's: a prompt, or output in columns. */
function terminalOutput(lines: string[]): boolean {
  const filled = lines.filter((line) => line.trim() !== "");
  if (filled.length < 2 || filled.some((line) => /^\s*```/.test(line)))
    return false;
  if (filled.some((line) => PROMPT.test(line))) return true;
  return filled.filter((line) => COLUMNS.test(line)).length >= 2;
}

/** Whether each line is a fence's or inside one. */
function fencedLines(lines: string[]): boolean[] {
  let fence: string | null = null;
  return lines.map((line) => {
    const marker = /^[ \t]*(```|~~~|\$\$)/.exec(line)?.[1];
    if (fence) {
      if (marker === fence) fence = null;
      return true;
    }
    if (marker) fence = marker;
    return !!marker;
  });
}

/** A PDF's ligatures and radical forms as the letters they stand for. */
function plainLetters(text: string): string {
  return text.replace(/[\ufb00-\ufb06\u2e80-\u2fdf]/g, (c) =>
    c.normalize("NFKC"),
  );
}

/** A line set out a character at a time ("第 一 章") closed up. */
function closeUpSpacedCjk(line: string): string {
  const chars = line.trim().split(/[ \u3000]+/);
  if (chars.length < 4 || !chars.every((c) => [...c].length === 1)) return line;
  return CJK.test(line) ? chars.join("") : line;
}

/**
 * Lines wrapped at a width rejoined: a line within a little of the
 * longest, stopping mid-clause, and the next line going on with the same
 * paragraph. Only where the lines run to a width - short lines are a
 * writer's own, as in an email.
 */
function rejoinWrapped(lines: string[], fenced: boolean[]): string[] {
  const lengths = lines.map((line, i) =>
    fenced[i] ? 0 : [...line.trimEnd()].length,
  );
  const widest = Math.max(0, ...lengths);
  const cjk = CJK.test(lines.filter((_, i) => !fenced[i]).join(""));
  if (widest < (cjk ? 16 : 40)) return lines;
  // Wrapped at a width, several lines run to it; one long line among short
  // ones - a chat message with a link in it - is the writer's.
  const atWidth = lengths.filter((n) => n >= widest * 0.85).length >= 2;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (i + 1 < lines.length) {
      const here = line.trimEnd();
      const next = lines[i + 1];
      const wraps =
        !fenced[i] &&
        !fenced[i + 1] &&
        here !== "" &&
        next.trim() !== "" &&
        !BLOCK_LINE.test(next) &&
        // A word broken with a hyphen goes on whatever the width.
        ((atWidth && [...lines[i].trimEnd()].length >= widest * 0.75) ||
          /\p{L}-$/u.test(here)) &&
        !ENDS_CLAUSE.test(here) &&
        // Not after a web address, nor a rule ("- - -").
        !/https?:\/\/\S+$/.test(here) &&
        !/^\s*([-*_])(\s*\1){2,}\s*$/.test(here) &&
        (/^\s*[\p{Ll}\d(]/u.test(next) || CJK.test(next.trim()[0] ?? ""));
      if (!wraps) break;
      // No space between CJK, nor after a word broken with a hyphen
      // ("hand-" "written"): the hyphen stays, as it may be the word's.
      const joint =
        CJK.test(here.slice(-1)) ||
        CJK.test(next.trim()[0] ?? "") ||
        /\p{L}-$/u.test(here)
          ? ""
          : " ";
      line = here + joint + next.trim();
      i++;
    }
    out.push(line);
  }
  return out;
}

/** `text` with its quote bars made Markdown quotes, the line breaks
 *  inside its paragraphs kept, and a terminal's output a code block. */
export function keepPastedLines(text: string): string {
  let lines = text.replace(/\r\n?/g, "\n").split("\n");
  const quote = quotedWithBars(lines);
  if (quote) lines = lines.map((line) => line.replace(QUOTE_BAR, ""));
  if (terminalOutput(lines)) {
    const body = plainLetters(lines.join("\n")).replace(/^\n+|\n+$/g, "");
    const fenced = "```text\n" + body + "\n```";
    return quote
      ? fenced
          .split("\n")
          .map((line) => (line.trim() ? `> ${line}` : ">"))
          .join("\n")
      : fenced;
  }
  // A PDF's bullets ("•") as Markdown's, so they are a list.
  const fenced = fencedLines(lines);
  lines = rejoinWrapped(
    lines.map((line, i) =>
      fenced[i]
        ? line
        : closeUpSpacedCjk(plainLetters(line)).replace(
            /^(\s*)[•●▪◦]\s+/,
            "$1- ",
          ),
    ),
    fenced,
  );
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
    // Two spaces, not a backslash: a backslash after a web address is
    // read as part of it, and one ending the line already escapes it.
    return breaks ? `${line.trimEnd()}  ` : line;
  });
  return out
    .map((line) => (!quote ? line : line.trim() ? `> ${line}` : ">"))
    .join("\n");
}
