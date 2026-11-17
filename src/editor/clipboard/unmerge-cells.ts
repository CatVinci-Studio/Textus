/** A cell spans more than its own place. */
const merged = (cell: Element) =>
  Number(cell.getAttribute("colspan") ?? 1) > 1 ||
  Number(cell.getAttribute("rowspan") ?? 1) > 1;

/** How far a cell reaches, capped: a stray "rowspan=1000" stays a table. */
const span = (cell: Element, name: string) =>
  Math.min(64, Math.max(1, Math.floor(Number(cell.getAttribute(name)) || 1)));

/**
 * Each merged cell of `root`'s tables split back into its places, the text
 * in the first, the rest empty: a Markdown table has no merged cells, and
 * the table tools count one place a cell. False when there were none.
 */
export function unmergeCells(root: ParentNode): boolean {
  let changed = false;
  for (const table of root.querySelectorAll("table")) {
    const rows = [...table.querySelectorAll("tr")].filter(
      (tr) => tr.closest("table") === table,
    );
    const cellsOf = (tr: Element) =>
      [...tr.children].filter(
        (c) => c.localName === "td" || c.localName === "th",
      );
    if (!rows.some((tr) => cellsOf(tr).some(merged))) continue;
    // Each row's places, filled in reading order as the browser lays them.
    const grid: Element[][] = rows.map(() => []);
    rows.forEach((tr, r) => {
      let col = 0;
      for (const cell of cellsOf(tr)) {
        while (grid[r][col]) col++;
        const across = span(cell, "colspan");
        const down = Math.min(span(cell, "rowspan"), rows.length - r);
        cell.removeAttribute("colspan");
        cell.removeAttribute("rowspan");
        for (let i = 0; i < down; i++)
          for (let j = 0; j < across; j++)
            grid[r + i][col + j] =
              i === 0 && j === 0
                ? cell
                : table.ownerDocument.createElement(cell.localName);
        col += across;
      }
    });
    rows.forEach((tr, r) => {
      for (const cell of grid[r]) if (cell) tr.appendChild(cell);
    });
    changed = true;
  }
  return changed;
}
