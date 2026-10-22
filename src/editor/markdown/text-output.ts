import {
  defaultHandlers,
  type Handle,
  type State,
} from "mdast-util-to-markdown";
import type { MathData, Phrasing } from "./span-output";

/**
 * Plain text and line breaks written back: alert markers and LaTeX left
 * unescaped, escapes only where needed, soft and hard breaks in the
 * document's own style, and the display width tables are padded by
 * (markdown-output.ts).
 */

/**
 * A callout's marker - `> [!NOTE]` and its kin, opening a quote - is
 * written as it was typed. remark escapes the bracket ("\\[!NOTE]") in case
 * it starts a reference link, which Textus still reads as an alert
 * (github-alert-plugin.ts) but GitHub and every other tool no longer do.
 * Any type word in any case counts, with Obsidian's fold sign after it
 * (`[!tip]-`): Obsidian has callout types of its own (`[!question]`), which
 * Textus shows as a plain quote but must not break for the tools that
 * read them.
 */
export const ALERT_MARKER = /^\\(\[![A-Za-z]+\])/;

export function keepAlertMarker(text: Handle): Handle {
  return (node, parent, state, info) => {
    const out = text(node, parent, state, info);
    const opensQuote =
      parent?.type === "paragraph" &&
      parent.children[0] === node &&
      state.stack.includes("blockquote");
    return opensQuote ? out.replace(ALERT_MARKER, "$1") : out;
  };
}

/**
 * Text ending in a space is escaped like any other. Milkdown's text
 * handler returns such text as it is, to keep the space from being written
 * `&#x20;`, and so wrote `# bar ` at the start of a line unescaped - a
 * heading on reopening - once the word after it was deleted or made bold;
 * a `- ` or `1. ` likewise became a list. The space is still kept as it is.
 */
export function escapingBeforeSpaces(text: Handle): Handle {
  return (node, parent, state, info) => {
    const value = node.value;
    const body = value.replace(/\s+$/, "");
    if (body === value || /[*_\\]/.test(value))
      return text(node, parent, state, info);
    const spaces = value.slice(body.length);
    if (body)
      return state.safe(body, { ...info, after: spaces, encode: [] }) + spaces;
    // Spaces alone, at the start of a line with more after them, are
    // encoded: a tab there opens indented code. A line of spaces only
    // stays as it is.
    const lineStart = !info.before || /[\r\n]$/.test(info.before);
    const more = info.after !== undefined && !/^[\r\n]?$/.test(info.after);
    return lineStart && more && !/[\r\n]/.test(spaces)
      ? state.safe(spaces, { ...info, encode: [] })
      : spaces;
  };
}

/** Per serialization: the escaped openers, `\\[` and `\\(`, written so far. */
export const openEscapes = new WeakMap<State, Set<string>>();
export const OPENERS: Record<string, string> = { "]": "[", ")": "(" };
export const REFERENCES: Record<string, string> = {
  "]": "&#93;",
  ")": "&#41;",
};

/** Text nodes with a formula written `\\[...\\]` or `\\(...\\)` after them
 *  in their paragraph, heading or cell, by its opening bracket. */
export const latexAhead = new WeakMap<Phrasing, Set<string>>();
export const PHRASING_BLOCKS = new Set(["paragraph", "heading", "tableCell"]);

export function markLatexAhead(node: Phrasing): void {
  if (!PHRASING_BLOCKS.has(node.type)) {
    node.children?.forEach(markLatexAhead);
    return;
  }
  const leaves: Phrasing[] = [];
  const walk = (child: Phrasing) => {
    if (child.children) child.children.forEach(walk);
    else leaves.push(child);
  };
  walk(node);
  const ahead = new Set<string>();
  for (const leaf of leaves.reverse()) {
    const delimiter =
      leaf.type === "inlineMath"
        ? (leaf.data as MathData)?.mathDelimiter
        : undefined;
    if (delimiter?.startsWith("\\")) ahead.add(delimiter.charAt(1));
    else if (leaf.type === "text" && ahead.size)
      latexAhead.set(leaf, new Set(ahead));
  }
}

/**
 * Brackets escaped as text never pair into LaTeX math. Textus reads
 * `\\[...\\]` and `\\(...\\)` as maths (latex-math-syntax.ts), and remark
 * escapes both brackets of a link text's `[b]` - so editing
 * `[Tech [Episodes]](u)` saved `[Tech \\[Episodes\\]](u)`, which read back
 * as a formula. Every escaped closer after an escaped opener is written as
 * a character reference instead, which reads as the bracket everywhere.
 * So is an escaped opener with a formula in LaTeX's brackets after it in
 * its block: before `\\[x\\]`, a `\\[` the text was written with opened a
 * formula that ran to that one's end (`[['\\[', '\\]']` in a config
 * snippet, once edited).
 */
export function withoutLatexPairs(text: Handle): Handle {
  return (node, parent, state, info) => {
    const out = text(node, parent, state, info);
    if (!out.includes("\\")) return out;
    let open = openEscapes.get(state);
    if (!open) openEscapes.set(state, (open = new Set()));
    const opened = open;
    return out.replace(/\\([\s\S])/g, (escape, char: string) => {
      if (char === "[" || char === "(") {
        if (latexAhead.get(node as Phrasing)?.has(char))
          return char === "[" ? "&#91;" : "&#40;";
        opened.add(char);
      } else if (OPENERS[char] && opened.has(OPENERS[char]))
        return REFERENCES[char];
      return escape;
    });
  };
}

/**
 * Line ends in a paragraph's text, Milkdown's soft breaks, as Markdown can
 * hold them: one at a time, and not at the paragraph's ends. Each is shown
 * as a space; deleting the one word on a line left two in a row, which were
 * written as a blank line and split the paragraph in two, and one at the
 * end of a paragraph (its last line's words deleted) was a stray line.
 */
export function withSingleLineEnds(text: Handle): Handle {
  return (node, parent, state, info) => {
    const siblings = (parent?.children ?? []) as Phrasing[];
    const index = siblings.indexOf(node);
    // Each soft break is a text node of its own.
    const previous = siblings[index - 1];
    let value = node.value.replace(/\n[ \t]*(?:\n[ \t]*)+/g, "\n");
    if (
      index === 0 ||
      (previous?.type === "text" && /\n[ \t]*$/.test(previous.value ?? ""))
    )
      value = value.replace(/^\n+/, "");
    if (index === siblings.length - 1) value = value.replace(/\n+$/, "");
    // In place: the handlers inside find the node among its siblings.
    node.value = value;
    return text(node, parent, state, info);
  };
}

/**
 * A hard line break as Markdown can hold it. At the end of a paragraph it
 * is nothing: `\\` there is a literal backslash, so a Shift+Enter left at
 * the end of a line came back as one. Before a line end that is already in
 * the text (a `<br>` at the end of a line, br-hardbreak-plugin.ts) it is
 * the backslash alone: its own line end and that one made a blank line,
 * which split the paragraph. In a table cell it is `<br>`, and nothing
 * at the cell's end, as at a paragraph's.
 */
export const hardBreak: Handle = (node, parent, state, info) => {
  const siblings = (parent?.children ?? []) as {
    type: string;
    value?: string;
  }[];
  const rest = siblings.slice(siblings.indexOf(node as never) + 1);
  if (
    rest.every(
      (next) =>
        next.type === "break" ||
        (next.type === "text" && !/[^\s]/.test(next.value ?? "")),
    )
  )
    return "";
  // A table row is one line: a break in a cell is written as the HTML
  // one, read back as a break (br-hardbreak-plugin.ts). remark wrote a
  // space.
  if (state.stack.includes("tableCell")) return "<br>";
  const out = defaultHandlers.break(node, parent, state, info);
  return rest[0]?.type === "text" && rest[0].value?.startsWith("\n")
    ? out.replace(/\n$/, "")
    : out;
};

/** A hard break as two spaces at the line's end, for a document written
 *  that way (documentBreaks) - after text only: spaces opening a line are
 *  nothing, and a break there stays a backslash. */
export const hardBreakAsSpaces: Handle = (node, parent, state, info) => {
  const out = hardBreak(node, parent, state, info);
  const siblings = (parent?.children ?? []) as Phrasing[];
  const before = siblings.slice(0, siblings.indexOf(node as Phrasing));
  const afterText = before.some(
    (child) => child.type !== "break" && !/^\s*$/.test(child.value ?? "x"),
  );
  return afterText && /[^\s]$/.test(info.before)
    ? out.replace(/^\\\n/, "  \n")
    : out;
};

/**
 * How the document's own hard breaks are written, by majority: a
 * backslash or two spaces at the end of the line. remark writes the
 * backslash, so an edit to a paragraph with a two-space break rewrote it.
 * Lines inside fenced code don't count.
 */
export function documentBreaks(markdown: string): "backslash" | "spaces" {
  let spaces = 0;
  let backslashes = 0;
  let fence: string | null = null;
  const lines = markdown.split(/\r?\n/);
  lines.forEach((line, i) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || marker.startsWith(fence))) {
      fence = fence ? null : marker.slice(0, 3);
      return;
    }
    if (fence || !lines[i + 1]?.trim() || !line.trim()) return;
    if (/\S {2,}$/.test(line)) spaces++;
    else if (/(^|[^\\])(\\\\)*\\$/.test(line)) backslashes++;
  });
  return spaces > backslashes ? "spaces" : "backslash";
}

/**
 * How wide a table cell's text is in a monospaced editor, for padding the
 * columns of a table written back: Chinese, Japanese and Korean
 * characters, full-width forms and most emoji take two columns. Counted as
 * one, a column of Chinese came out ragged in every source view.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    width += isWide(code) ? 2 : 1;
  }
  return width;
}

export function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}
