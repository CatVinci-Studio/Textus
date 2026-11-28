import { FRONTMATTER } from "./frontmatter";
import { THEMATIC_BREAK } from "./markdown-lines";

// The Outline lists these headings and a row's jump goes to the editor's
// n-th top-level heading node, so this must read blocks as the editor's
// parser does (CommonMark, GFM tables and footnotes, remark-math's `$$`
// with Textus's loose form), or every row after a stray one lands on the
// next heading (#851). One pass over the lines: it runs on each edit.

/** A top-level heading as the editor reads it: its level, its text, the
 *  line it starts on and the line it ends on (a setext one's underline). */
export interface HeadingLine {
  level: number;
  text: string;
  line: number;
  end: number;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*(?:[ \t]#+[ \t]*)?$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const QUOTE = /^ {0,3}>[ \t]?/;
const LIST_MARKER = /^ {0,3}([-+*]|\d{1,9}[.)])(?=[ \t]|$)/;
const FOOTNOTE = /^ {0,3}\[\^[^\]\s]+\]:[ \t]?/;
// A link reference definition: its label, destination and title may each
// start on the next line. With a title that runs on into words, it is the
// definition without its title, if that ends its line.
const DEFINITION_HEAD = String.raw` {0,3}\[(?:[^\]\\]|\\.)+\]:[ \t]*\n?[ \t]*(?:<[^<>\n]*>|[^\s<>]\S*)`;
const DEFINITION_TITLE = String.raw`(?:[ \t]+|[ \t]*\n[ \t]*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\))`;
const DEFINITIONS = [
  new RegExp(`^${DEFINITION_HEAD}${DEFINITION_TITLE}[ \\t]*(?:\\n|$)`),
  new RegExp(`^${DEFINITION_HEAD}[ \\t]*(?:\\n|$)`),
];
const TABLE_DELIMITER =
  /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const BLOCK_TAGS =
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
const ATTRIBUTE = `\\s+[A-Za-z_:][\\w.:-]*(?:\\s*=\\s*(?:[^\\s"'=<>\`]+|'[^']*'|"[^"]*"))?`;

/** CommonMark's seven kinds of HTML block: what opens one, what line ends
 *  it (null: a blank line), and whether it may cut a paragraph short. */
const HTML_BLOCKS: { open: RegExp; close: RegExp | null; cuts: boolean }[] = [
  {
    open: /^ {0,3}<(?:script|pre|style|textarea)(?=[\s>]|$)/i,
    close: /<\/(?:script|pre|style|textarea)>/i,
    cuts: true,
  },
  { open: /^ {0,3}<!--/, close: /-->/, cuts: true },
  { open: /^ {0,3}<\?/, close: /\?>/, cuts: true },
  { open: /^ {0,3}<![A-Za-z]/, close: />/, cuts: true },
  { open: /^ {0,3}<!\[CDATA\[/, close: /\]\]>/, cuts: true },
  {
    open: new RegExp(`^ {0,3}</?(?:${BLOCK_TAGS})(?=[\\s/>]|$)`, "i"),
    close: null,
    cuts: true,
  },
  {
    open: new RegExp(
      `^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:${ATTRIBUTE})*\\s*/?>|</[A-Za-z][A-Za-z0-9-]*\\s*>)[ \\t]*$`,
    ),
    close: null,
    cuts: false,
  },
];

/** An open container: a quote, or a list item or footnote whose lines
 *  are indented `indent` columns, `empty` while it holds nothing yet.
 *  Nothing inside one is top-level. */
type Container = { quote: true } | { indent: number; empty: boolean };

/** The open leaf block, and how deep in the containers it sits. */
type Leaf = { depth: number } & (
  | { kind: "paragraph"; lines: string[]; line: number }
  | { kind: "fence"; mark: string }
  | { kind: "math" }
  | { kind: "html"; close: RegExp | null }
  | { kind: "indented" }
  | { kind: "table" }
);

const isBlank = (s: string) => s.trim() === "";
const indentOf = (s: string) => s.length - s.trimStart().length;

/** `line` with the tabs among its leading markers as spaces, to the next
 *  multiple of four, so indents count in columns. */
function expandTabs(line: string): string {
  const lead = /^[ \t>*+\-.)\d]*/.exec(line)![0];
  if (!lead.includes("\t")) return line;
  let out = "";
  for (const c of lead)
    out += c === "\t" ? " ".repeat(4 - (out.length % 4)) : c;
  return out + line.slice(lead.length);
}

/** The rest of `line` inside `container`, or null when the line ends it. */
function continues(container: Container, line: string): string | null {
  if ("quote" in container) {
    const quote = QUOTE.exec(line);
    return quote ? line.slice(quote[0].length) : null;
  }
  // An item can start with one blank line: a second ends it.
  if (isBlank(line)) return container.empty ? null : "";
  return indentOf(line) >= container.indent
    ? line.slice(container.indent)
    : null;
}

/** How many of a paragraph's first lines are link reference definitions:
 *  text no heading can be made of. */
function definitionLines(lines: string[]): number {
  const text = lines.join("\n");
  let at = 0;
  let count = 0;
  while (at < text.length) {
    const rest = text.slice(at);
    const found = DEFINITIONS.map((d) => d.exec(rest)).find(Boolean);
    if (!found) break;
    at += found[0].length;
    const breaks = found[0].split("\n").length - 1;
    count += found[0].endsWith("\n") ? breaks : breaks + 1;
  }
  return count;
}

/** A list item or footnote opening on `line`: its indent and the rest.
 *  Cutting a paragraph short, an item can't be empty or number from
 *  other than 1, and a footnote can't. */
function opensItem(
  line: string,
  cuts: boolean,
): { indent: number; rest: string } | null {
  const note = FOOTNOTE.exec(line);
  if (note && !cuts) return { indent: 4, rest: line.slice(note[0].length) };
  const marker = LIST_MARKER.exec(line);
  if (!marker || THEMATIC_BREAK.test(line)) return null;
  const after = line.slice(marker[0].length);
  const empty = isBlank(after);
  const numbered = /^\d/.test(marker[1]);
  if (cuts && (empty || (numbered && parseInt(marker[1], 10) !== 1)))
    return null;
  // Five spaces or more after the marker start indented code: the item's
  // text is one space in.
  const spaces = indentOf(after);
  const pad = empty || spaces > 4 ? 1 : spaces;
  return {
    indent: marker[0].length + pad,
    rest: empty ? "" : after.slice(pad),
  };
}

/** Whether the `$$` line `rest` opens a math block as the editor reads it
 *  (remark-math and looseMathFlow): `$$x$$` alone is inline maths in a
 *  paragraph; words holding a `$` after the opener (`$$x$$ is famous`)
 *  open one only when a later line closes it. */
function opensMath(rest: string, closedLater: () => boolean): boolean {
  const trimmed = rest.trim();
  if (!trimmed.startsWith("$$")) return false;
  const words = trimmed.replace(/^\$+/, "");
  if (words.trim() && words.endsWith("$$")) return false;
  return !/(?:^|[^\\])\$/.test(words) || closedLater();
}

/** The number of cells in a table row, outer pipes aside. */
const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/).length;

/** Whether `row` under the one-line paragraph `header` makes a table. */
function opensTable(header: string, row: string): boolean {
  return (
    TABLE_DELIMITER.test(row) &&
    (row.includes("|") || header.includes("|")) &&
    cells(row) === cells(header)
  );
}

/** Whether `rest` starts a block that ends a paragraph above it. */
function cutsParagraph(rest: string, closedLater: () => boolean): boolean {
  if (indentOf(rest) >= 4) return false;
  const fence = FENCE.exec(rest);
  return (
    ATX.test(rest) ||
    (!!fence && !(fence[1][0] === "`" && fence[2].includes("`"))) ||
    opensMath(rest, closedLater) ||
    THEMATIC_BREAK.test(rest) ||
    QUOTE.test(rest) ||
    opensItem(rest, true) !== null ||
    HTML_BLOCKS.some((html) => html.cuts && html.open.test(rest))
  );
}

/** How the open leaf takes `rest`: a line of it, its last, or not its. */
function leafTakes(leaf: Leaf, rest: string, closedLater: () => boolean) {
  switch (leaf.kind) {
    case "fence": {
      const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(rest);
      return close &&
        close[1][0] === leaf.mark[0] &&
        close[1].length >= leaf.mark.length
        ? "last"
        : "in";
    }
    case "math":
      return rest.trimEnd().endsWith("$$") ? "last" : "in";
    case "html":
      if (leaf.close) return leaf.close.test(rest) ? "last" : "in";
      return isBlank(rest) ? "out" : "in";
    case "indented":
      return isBlank(rest) || indentOf(rest) >= 4 ? "in" : "out";
    case "table":
      return isBlank(rest) || cutsParagraph(rest, closedLater) ? "out" : "in";
    default:
      return "out";
  }
}

/** The last text scanned and its headings: the outline, its phone menu,
 *  a heading search, a plugin's getOutline and a source jump all ask about
 *  the same text after an edit, and share one scan. */
let last: { markdown: string; headings: readonly Readonly<HeadingLine>[] } = {
  markdown: "",
  headings: [],
};

/** A whole document's top-level headings, in order, as the editor counts
 *  them: ATX and setext, never in code, maths, HTML blocks, front matter,
 *  quotes, list items or footnotes. Shared: never changed by a caller. */
export function headingsOf(markdown: string): readonly Readonly<HeadingLine>[] {
  if (markdown !== last.markdown)
    last = { markdown, headings: Object.freeze(scan(markdown)) };
  return last.headings;
}

function scan(markdown: string): HeadingLine[] {
  const out: HeadingLine[] = [];
  const lines = markdown.split("\n");
  const head = FRONTMATTER.exec(markdown)?.[0] ?? "";
  const yamlLines = head ? head.replace(/\n$/, "").split("\n").length : 0;
  // The last line a `$$` block could close on, found once if ever asked.
  let lastCloser: number | null = null;
  let index = 0;
  const stack: Container[] = [];
  /** Whether a line after this one, inside the first `depth` containers,
   *  could close a `$$` block. At the top, any line to the end. */
  const closedWithin = (depth: number) => {
    if (depth === 0) {
      if (lastCloser === null) {
        lastCloser = -1;
        for (let i = lines.length - 1; i >= 0 && lastCloser < 0; i--)
          if (lines[i].trimEnd().endsWith("$$")) lastCloser = i;
      }
      return lastCloser > index;
    }
    for (let i = index + 1; i < lines.length; i++) {
      let rest: string | null = expandTabs(lines[i]);
      for (let c = 0; c < depth && rest !== null; c++)
        rest = continues(stack[c], rest);
      if (rest === null) return false;
      if (rest.trimEnd().endsWith("$$")) return true;
    }
    return false;
  };
  let leaf: Leaf | null = null;

  for (; index < lines.length; index++) {
    if (index < yamlLines) continue;
    let rest = expandTabs(lines[index]);
    let matched = 0;
    for (; matched < stack.length; matched++) {
      const container = stack[matched];
      const inner = continues(container, rest);
      if (inner === null) break;
      rest = inner;
      if ("empty" in container && !isBlank(rest)) container.empty = false;
    }
    const lazyClosed = () => closedWithin(matched);
    if (matched < stack.length) {
      // A lazy line: a paragraph in a container goes on without its marks.
      if (
        leaf?.kind === "paragraph" &&
        !isBlank(rest) &&
        !cutsParagraph(rest, lazyClosed)
      )
        continue;
      stack.length = matched;
      if (leaf && leaf.depth > matched) leaf = null;
    }
    const closedLater = () => closedWithin(stack.length);
    if (leaf && leaf.kind !== "paragraph") {
      const took = leafTakes(leaf, rest, closedLater);
      if (took === "last") leaf = null;
      if (took !== "out") continue;
      leaf = null;
    }
    // New containers; a paragraph's setext line or table row isn't one.
    for (;;) {
      if (indentOf(rest) >= 4) break;
      const paragraph: Extract<Leaf, { kind: "paragraph" }> | null =
        leaf?.kind === "paragraph" ? leaf : null;
      if (
        paragraph &&
        (SETEXT.test(rest) ||
          (paragraph.lines.length === 1 &&
            opensTable(paragraph.lines[0], rest)))
      )
        break;
      const quote = QUOTE.exec(rest);
      const item = quote ? null : opensItem(rest, paragraph !== null);
      if (!quote && !item) break;
      leaf = null;
      stack.push(
        quote
          ? { quote: true }
          : { indent: item!.indent, empty: isBlank(item!.rest) },
      );
      rest = quote ? rest.slice(quote[0].length) : item!.rest;
    }
    const depth = stack.length;
    if (leaf?.kind === "paragraph") {
      if (isBlank(rest)) {
        leaf = null;
        continue;
      }
      const underline = SETEXT.exec(rest);
      if (underline) {
        // Definitions lead a paragraph; once text starts, a line is text.
        const text = leaf.lines.slice(definitionLines(leaf.lines));
        if (text.length && depth === 0)
          out.push({
            level: underline[1][0] === "=" ? 1 : 2,
            text: text.map((l) => l.trim()).join("\n"),
            line: leaf.line + leaf.lines.length - text.length,
            end: index,
          });
        // Under definitions alone `===` is text and `---` a rule.
        if (!text.length && underline[1][0] === "=") leaf.lines.push(rest);
        else leaf = null;
        continue;
      }
      if (leaf.lines.length === 1 && opensTable(leaf.lines[0], rest)) {
        leaf = { kind: "table", depth };
        continue;
      }
      if (!cutsParagraph(rest, closedLater)) {
        leaf.lines.push(rest);
        continue;
      }
    }
    // Whatever was open ends here: this line starts a block of its own.
    leaf = opensLeaf(rest, depth, index, closedLater, (level, text) => {
      if (depth === 0) out.push({ level, text, line: index, end: index });
    });
  }
  return out;
}

/** The leaf block `rest` opens, or null; an ATX heading goes to `heading`. */
function opensLeaf(
  rest: string,
  depth: number,
  index: number,
  closedLater: () => boolean,
  heading: (level: number, text: string) => void,
): Leaf | null {
  if (isBlank(rest)) return null;
  if (indentOf(rest) >= 4) return { kind: "indented", depth };
  const atx = ATX.exec(rest);
  if (atx) {
    heading(atx[1].length, atx[2] ?? "");
    return null;
  }
  const fence = FENCE.exec(rest);
  // A backtick fence's info string can't hold a backtick: ```a``` is code.
  if (fence && !(fence[1][0] === "`" && fence[2].includes("`")))
    return { kind: "fence", mark: fence[1], depth };
  if (opensMath(rest, closedLater)) return { kind: "math", depth };
  const html = HTML_BLOCKS.find((h) => h.open.test(rest));
  if (html)
    return html.close?.test(rest)
      ? null
      : { kind: "html", close: html.close, depth };
  if (THEMATIC_BREAK.test(rest)) return null;
  return { kind: "paragraph", lines: [rest], line: index, depth };
}
