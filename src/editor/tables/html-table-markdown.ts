// A simple HTML table as a Markdown table: no merged cells and only inline
// content, which a Markdown table can hold. Anything else stays HTML.

import { inlineLink } from "../markdown/link-syntax";
import { escapeCellPipes } from "./cell-pipes";

/** Why a table can't become Markdown, for the menu item's reason. */
export type TableRefusal = "notTable" | "merged" | "blocks";

export type TableConversion = { markdown: string } | { refused: TableRefusal };

// How each inline tag is written; a tag not here (a <p>, a list) is block
// content a cell can't hold.
const WRAP: Record<string, [string, string]> = {
  b: ["**", "**"],
  strong: ["**", "**"],
  i: ["*", "*"],
  em: ["*", "*"],
  sup: ["^", "^"],
  sub: ["~", "~"],
  del: ["~~", "~~"],
  s: ["~~", "~~"],
  mark: ["==", "=="],
  span: ["", ""],
  u: ["<u>", "</u>"],
  kbd: ["<kbd>", "</kbd>"],
  font: ["", ""],
};

class Blocks extends Error {}

/** A cell's content as one line of Markdown. */
function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE)
    return (node.textContent ?? "").replace(/\s+/g, " ");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.localName;
  const inner = () => [...el.childNodes].map(inline).join("");
  if (tag === "br") return "<br>";
  if (tag === "code") return `\`${el.textContent ?? ""}\``;
  if (tag === "a") {
    const href = el.getAttribute("href");
    if (!href) return inner();
    return inlineLink(inner(), href.replace(/[<>]/g, encodeURIComponent));
  }
  if (tag === "img")
    return `![${el.getAttribute("alt") ?? ""}](${el.getAttribute("src") ?? ""})`;
  const wrap = WRAP[tag];
  if (!wrap) throw new Blocks();
  const text = inner();
  return text.trim() ? wrap[0] + text + wrap[1] : text;
}

// `$ x $` as written by chat replies, tightened so it reads as a formula; a
// price ("$5 and $6") has no space after its dollar sign.
const SPACED_MATH = /\$[ \t]+([^$\n]*?\S)[ \t]*\$/g;

function cellText(cell: Element): string {
  const text = [...cell.childNodes].map(inline).join("").trim();
  return escapeCellPipes(text.replace(SPACED_MATH, "$$$1$$"));
}

function alignOf(cell: Element | undefined): string {
  const align = (
    cell?.getAttribute("align") ??
    /text-align:\s*(\w+)/i.exec(cell?.getAttribute("style") ?? "")?.[1] ??
    ""
  ).toLowerCase();
  return align === "center"
    ? ":---:"
    : align === "right"
      ? "---:"
      : align === "left"
        ? ":---"
        : "---";
}

/** `html` - one table, alone - as a Markdown table, or why not. */
export function htmlTableToMarkdown(html: string): TableConversion {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const children = [...body.childNodes].filter(
    (n) => n.nodeType !== Node.TEXT_NODE || n.textContent?.trim(),
  );
  const table = children[0] as Element | undefined;
  if (children.length !== 1 || table?.localName !== "table")
    return { refused: "notTable" };
  const rows = [...table.querySelectorAll("tr")].filter(
    (tr) => tr.closest("table") === table,
  );
  if (rows.length === 0) return { refused: "notTable" };
  const cells = rows.map((tr) =>
    [...tr.children].filter(
      (c) => c.localName === "td" || c.localName === "th",
    ),
  );
  if (
    cells.flat().some((c) => Number(c.getAttribute("rowspan") ?? 1) > 1) ||
    cells.flat().some((c) => Number(c.getAttribute("colspan") ?? 1) > 1)
  )
    return { refused: "merged" };
  let text: string[][];
  try {
    text = cells.map((row) => row.map(cellText));
  } catch (error) {
    if (error instanceof Blocks) return { refused: "blocks" };
    throw error;
  }
  const width = Math.max(1, ...text.map((row) => row.length));
  const line = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
  const head = headerRow(rows, cells);
  const aligns = Array.from({ length: width }, (_, i) =>
    alignOf(cells[head][i]),
  );
  return {
    markdown: [
      line(text[head]),
      `| ${aligns.join(" | ")} |`,
      ...text.filter((_, i) => i !== head).map(line),
    ].join("\n"),
  };
}

/** The row Markdown heads the table with: the one in <thead> or made of
 *  <th> cells, else the first. */
function headerRow(rows: Element[], cells: Element[][]): number {
  const found = rows.findIndex(
    (tr, i) =>
      tr.parentElement?.localName === "thead" ||
      (cells[i].length > 0 && cells[i].every((c) => c.localName === "th")),
  );
  return Math.max(0, found);
}
