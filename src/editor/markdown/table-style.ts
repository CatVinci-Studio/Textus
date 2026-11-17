import { displayWidth } from "./text-output";

/**
 * A table as its file wrote it. One whose columns weren't lined up keeps
 * every row it had as written, and a changed or new row takes the table's
 * own style (outer bars or none, spaces around cells or none); a lined-up
 * table is lined up again, as the serializer writes it.
 */

interface Table {
  rows: string[];
  /** Each row's cells, trimmed. */
  cells: string[][];
  outer: boolean;
  spaced: boolean;
}

const DELIMITER = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;

function cellsOf(row: string): string[] {
  const inner = row
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

function readTable(text: string): Table | null {
  const rows = text.split("\n");
  if (rows.length < 2 || !DELIMITER.test(rows[1].trim())) return null;
  if (!rows.every((row) => row.includes("|"))) return null;
  return {
    rows,
    cells: rows.map(cellsOf),
    outer: rows[0].trimStart().startsWith("|"),
    spaced: /\|\s/.test(rows[0]) || /\s\|/.test(rows[0]),
  };
}

/** Its bars stand at the same columns on every row. */
function linedUp(table: Table): boolean {
  const bars = (row: string) => {
    const at: number[] = [];
    let width = 0;
    for (const [k, char] of [...row].entries()) {
      if (char === "|" && row[k - 1] !== "\\") at.push(width);
      width += displayWidth(char);
    }
    return at.join(",");
  };
  const first = bars(table.rows[0]);
  return table.rows.every((row) => bars(row) === first);
}

const alignOf = (cell: string) =>
  `${cell.startsWith(":") ? "l" : ""}${cell.endsWith(":") ? "r" : ""}`;

function rowIn(table: Table, cells: string[]): string {
  const pad = table.spaced ? " " : "";
  const inner = cells.join(`${pad}|${pad}`);
  return table.outer ? `|${pad}${inner}${pad}|` : inner;
}

export function tableInTheFilesHand(
  original: string,
  written: string,
): string | null {
  const was = readTable(original);
  const now = readTable(written);
  // Lined up by its spaces: `|a|b|` over `|-|-|` only happens to be.
  if (!was || !now || (was.spaced && linedUp(was))) return null;
  const columns = now.cells[0].length;
  const same = (a: string[], b: string[]) =>
    a.length === b.length && a.every((cell, k) => cell === b[k]);
  const delimiterKept =
    was.cells[1].length === columns &&
    was.cells[1].every((cell, k) => alignOf(cell) === alignOf(now.cells[1][k]));
  const used = new Set<number>();
  return now.cells
    .map((cells, r) => {
      if (r === 1)
        return delimiterKept
          ? was.rows[1]
          : rowIn(
              was,
              cells.map((cell) => cell.replace(/-+/, "---")),
            );
      const k = was.cells.findIndex(
        (old, j) => j !== 1 && !used.has(j) && same(old, cells),
      );
      if (k < 0) return rowIn(was, cells);
      used.add(k);
      return was.rows[k];
    })
    .join("\n");
}
