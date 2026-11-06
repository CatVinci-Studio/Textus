/**
 * Obsidian block ids (`^abc123`): the one a block has, or a new one written
 * where Obsidian reads it - at the end of a paragraph's, heading's or list
 * item's last line; on a line of its own after a table, quote, code or math
 * block. Every other byte, line endings included, stays as it was.
 */

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}#{1,6}(?:\s|$)/;
const ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const QUOTE = /^\s{0,3}>/;
const DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const ID = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;
const ALONE = /^\s*\^([A-Za-z0-9-]+)\s*$/;

type Kind =
  "code" | "math" | "heading" | "item" | "quote" | "table" | "paragraph";

/** Blocks whose id goes on a line of its own after them. */
const ID_BELOW: readonly Kind[] = ["code", "math", "quote", "table"];

const blank = (line: string) => !line.trim();

function bodyStart(lines: string[]): number {
  if (lines[0] !== "---") return 0;
  for (let i = 1; i < lines.length; i++)
    if (lines[i] === "---" || lines[i] === "...") return i + 1;
  return 0;
}

/** Where the block starting at `i` ends (exclusive), and its kind. */
function extent(lines: string[], i: number): { end: number; kind: Kind } {
  const line = lines[i];
  const fence = FENCE.exec(line);
  if (fence) {
    const close = new RegExp(
      `^\\s{0,3}${fence[1][0]}{${fence[1].length},}\\s*$`,
    );
    for (let f = i + 1; f < lines.length; f++)
      if (close.test(lines[f])) return { end: f + 1, kind: "code" };
    return { end: lines.length, kind: "code" };
  }
  if (line.trim() === "$$") {
    for (let m = i + 1; m < lines.length; m++)
      if (lines[m].trim() === "$$") return { end: m + 1, kind: "math" };
    return { end: lines.length, kind: "math" };
  }
  if (HEADING.test(line)) return { end: i + 1, kind: "heading" };
  const kind: Kind = ITEM.test(line)
    ? "item"
    : QUOTE.test(line)
      ? "quote"
      : line.includes("|") && DELIMITER.test(lines[i + 1] ?? "")
        ? "table"
        : "paragraph";
  let end = i + 1;
  while (
    end < lines.length &&
    !blank(lines[end]) &&
    !HEADING.test(lines[end]) &&
    !FENCE.test(lines[end]) &&
    !(ITEM.test(lines[end]) && kind !== "table")
  )
    end++;
  return { end, kind };
}

/** The first line at or after `from` that isn't blank. */
function nextFilled(lines: string[], from: number): number {
  let i = from;
  while (i < lines.length && blank(lines[i])) i++;
  return i;
}

/** The block holding line `line` (from 0), with the id it has. */
function blockAt(lines: string[], line: number) {
  for (let i = bodyStart(lines); i < lines.length;) {
    if (blank(lines[i]) || ALONE.test(lines[i])) {
      i++;
      continue;
    }
    const { end, kind } = extent(lines, i);
    const below = nextFilled(lines, end);
    const alone = kind === "item" ? null : ALONE.exec(lines[below] ?? "");
    if (line >= i && (line < end || (alone && line === below))) {
      const inline =
        kind === "code" || kind === "math" ? null : ID.exec(lines[end - 1]);
      return { end, kind, id: inline?.[1] ?? alone?.[1] ?? null };
    }
    i = end;
  }
  return null;
}

function newId(text: string): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(3));
    const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    if (!text.includes(`^${id}`)) return id;
  }
}

/**
 * The id of the block at `line` of `text`, and the text with it written if
 * the block had none; null when no block is there (a blank line, front
 * matter).
 */
export function blockIdAt(
  text: string,
  line: number,
  makeId: (text: string) => string = newId,
): { id: string; text: string } | null {
  const parts = text.split("\n");
  const lines = parts.map((p) => p.replace(/\r$/, ""));
  const block = blockAt(lines, line);
  if (!block) return null;
  if (block.id) return { id: block.id, text };
  const id = makeId(text);
  const cr = text.includes("\r\n") ? "\r" : "";
  const last = block.end - 1;
  if (!ID_BELOW.includes(block.kind)) {
    const content = lines[last].replace(/\s+$/, "");
    parts[last] = content + ` ^${id}` + parts[last].slice(content.length);
    return { id, text: parts.join("\n") };
  }
  // A blank line, the id, and a blank line before any text that follows.
  const atEnd = block.end === parts.length;
  if (atEnd) parts[last] += cr;
  const added = ["" + cr, `^${id}` + (atEnd ? "" : cr)];
  if (!atEnd && !blank(lines[block.end])) added.push(cr);
  parts.splice(block.end, 0, ...added);
  return { id, text: parts.join("\n") };
}
