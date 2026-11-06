// Obsidian's inline syntaxes the parser keeps as plain text, found in a
// textblock's words: `%%comments%%`, a trailing `^block-id` and
// `^[inline footnotes]`. Code and other atoms stand in as OBJECT.

export const OBJECT = "￼";

export type InlineSyntax =
  | { kind: "comment"; from: number; to: number }
  | { kind: "blockId"; from: number; to: number }
  /** `inner` is the note's words, between `^[` and `]`. */
  | { kind: "footnote"; from: number; to: number; inner: [number, number] };

const COMMENT = /%%[\s\S]*?%%/g;
// A space or the line's start before it, nothing after it (Obsidian's rule).
const BLOCK_ID = /(?:^|[ \t])(\^[A-Za-z0-9-]+)[ \t]*$/;
const FOOTNOTE = /\^\[([^\]\n]*)\]/g;

/** The syntaxes in `text`, by offset; footnotes inside a comment are left
 *  to the comment. */
export function findInlineSyntax(text: string): InlineSyntax[] {
  const found: InlineSyntax[] = [];
  for (const m of text.matchAll(COMMENT))
    found.push({ kind: "comment", from: m.index, to: m.index + m[0].length });
  const inComment = (at: number) =>
    found.some((s) => s.kind === "comment" && at >= s.from && at < s.to);
  for (const m of text.matchAll(FOOTNOTE))
    if (!inComment(m.index) && m[1].trim())
      found.push({
        kind: "footnote",
        from: m.index,
        to: m.index + m[0].length,
        inner: [m.index + 2, m.index + 2 + m[1].length],
      });
  const id = BLOCK_ID.exec(text);
  if (id) {
    const from = id.index + id[0].indexOf("^");
    if (!inComment(from))
      found.push({ kind: "blockId", from, to: from + id[1].length });
  }
  return found;
}

/** `==🔴red==` and its five siblings: the colour a highlight's first
 *  character names, as Obsidian's colour emoji. */
export const MARK_COLOURS: Record<string, string> = {
  "🔴": "red",
  "🟠": "orange",
  "🟡": "yellow",
  "🟢": "green",
  "🔵": "blue",
  "🟣": "purple",
};

/** The colour emoji `text` opens with, or null. */
export function markColourAt(text: string): string | null {
  const first = [...text.slice(0, 2)][0];
  return first && first in MARK_COLOURS ? first : null;
}
