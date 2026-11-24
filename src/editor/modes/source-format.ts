import type { EditorView } from "@codemirror/view";
import { EditorSelection, type EditorState } from "@codemirror/state";

/**
 * The Format menu's marks and blocks in source mode, as Markdown written
 * out: a mark wraps the selection (or unwraps it), a block sets each
 * selected line's prefix (or takes it off).
 */

/** Each mark's Markdown, by the Format menu's name for it. */
const MARKERS: Record<string, string> = {
  bold: "**",
  italic: "*",
  strikethrough: "~~",
  highlight: "==",
  code: "`",
};

/** Wraps each selection in `mark`'s marker, or takes it off where it is
 *  already wrapped (inside or just outside the selection). False for a mark
 *  source mode doesn't write. */
export function toggleSourceMark(view: EditorView, mark: string): boolean {
  if (mark === "clear") return clearSourceMarks(view);
  const marker = MARKERS[mark];
  if (!marker) return false;
  const n = marker.length;
  const { state } = view;
  const slice = (from: number, to: number) =>
    state.sliceDoc(Math.max(0, from), Math.min(state.doc.length, to));
  view.dispatch(
    state.changeByRange((range) => {
      const text = slice(range.from, range.to);
      const before = slice(range.from - n, range.from);
      const after = slice(range.to, range.to + n);
      // A lone * is italic; one beside another is half of a bold **.
      const alone =
        marker !== "*" ||
        (slice(range.from - 2, range.from - 1) !== "*" &&
          slice(range.to + 1, range.to + 2) !== "*");
      if (before === marker && after === marker && alone)
        return {
          changes: [
            { from: range.from - n, to: range.from },
            { from: range.to, to: range.to + n },
          ],
          range: EditorSelection.range(range.from - n, range.to - n),
        };
      // Selected with its markers: one pair around words holding no other,
      // not half of a bold (**x**) taken for italic.
      const inner = text.slice(n, -n);
      if (
        text.length > 2 * n &&
        text.startsWith(marker) &&
        text.endsWith(marker) &&
        !inner.includes(marker) &&
        (marker !== "*" || !(inner.startsWith("*") || inner.endsWith("*")))
      )
        return {
          changes: {
            from: range.from,
            to: range.to,
            insert: text.slice(n, -n),
          },
          range: EditorSelection.range(range.from, range.to - 2 * n),
        };
      // Around the words only: a selection's spaces and line breaks at its
      // ends (all of a document, say) stay outside.
      const from = range.from + (text.length - text.trimStart().length);
      const to = Math.max(
        from,
        range.to - (text.length - text.trimEnd().length),
      );
      return {
        changes: [
          { from, insert: marker },
          { from: to, insert: marker },
        ],
        range: EditorSelection.range(from + n, to + n),
      };
    }),
  );
  return true;
}

/** A bold, italic, strikethrough or highlight run on one line. */
const SPAN = /(\*\*|__|~~|==|\*|_)(?=\S)([^\n]*?\S)\1/g;
const WORD = /[\p{L}\p{N}]/u;

/** Clear Formatting: the markers of every run the selection touches taken
 *  off, as the rendered editor does; code spans stay. False with nothing
 *  to clear. */
function clearSourceMarks(view: EditorView): boolean {
  const { state } = view;
  let cleared = false;
  const result = state.changeByRange((range) => {
    if (range.empty) return { range };
    const start = state.doc.lineAt(range.from).from;
    // Code spans masked; `at` holds each remaining character's offset.
    let text = state
      .sliceDoc(start, state.doc.lineAt(range.to).to)
      .replace(/`+[^`\n]*`+/g, (code) => "\u0001".repeat(code.length));
    let at = [...text].map((_, i) => start + i);
    const gone: { from: number; to: number }[] = [];
    const next = () =>
      [...text.matchAll(SPAN)].find((m) => {
        const end = m.index + m[0].length;
        // An underscore inside a word (snake_case) marks nothing.
        if (
          m[1][0] === "_" &&
          (WORD.test(text[m.index - 1] ?? "") || WORD.test(text[end] ?? ""))
        )
          return false;
        return at[m.index] < range.to && at[end - 1] >= range.from;
      });
    for (let m = next(); m; m = next()) {
      const n = m[1].length;
      const end = m.index + m[0].length;
      gone.push(
        { from: at[m.index], to: at[m.index] + n },
        { from: at[end - n], to: at[end - n] + n },
      );
      const keep = (_: unknown, i: number) =>
        i < m.index || (i >= m.index + n && i < end - n) || i >= end;
      text = [...text].filter(keep).join("");
      at = at.filter(keep);
    }
    if (!gone.length) return { range };
    cleared = true;
    const changes = state.changes(gone);
    return {
      changes,
      range: EditorSelection.range(
        changes.mapPos(range.from, 1),
        changes.mapPos(range.to, -1),
      ),
    };
  });
  if (cleared) view.dispatch(result);
  return cleared;
}

/** A line's block prefix: its quote, heading, list or task marker. */
const PREFIX =
  /^(\s*)(>\s?|#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;

/** Each block's prefix, by the Format menu's name for it. */
function prefixFor(kind: string): string | null {
  const heading = /^h([1-6])$/.exec(kind);
  if (heading) return `${"#".repeat(Number(heading[1]))} `;
  return (
    {
      paragraph: "",
      "bullet-list": "- ",
      "ordered-list": "1. ",
      "task-list": "- [ ] ",
      blockquote: "> ",
    }[kind] ?? null
  );
}

/** Sets each selected line's prefix to `kind`'s, or takes it off a line
 *  that has it already. False for a block source mode doesn't write. */
export function setSourceBlock(view: EditorView, kind: string): boolean {
  const prefix = prefixFor(kind);
  if (prefix === null) return false;
  const { state } = view;
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    // A selection ending at a line's start doesn't take that line.
    const end =
      range.to > range.from && state.doc.lineAt(range.to).from === range.to
        ? range.to - 1
        : range.to;
    for (
      let at = state.doc.lineAt(range.from).number;
      at <= state.doc.lineAt(end).number;
      at++
    )
      lines.add(at);
  }
  // Blank lines between stay blank, not empty items.
  const picked = [...lines].map((at) => state.doc.line(at));
  const written = picked.filter((line) => line.text.trim() !== "");
  const all = written.length ? written : picked;
  // Taken off when every line has it; else every line gets it.
  const has = (text: string) =>
    (PREFIX.exec(text)?.[2] ?? "").replace(/\s+$/, " ") === prefix ||
    (prefix === "1. " && /^\s*\d+[.)]\s/.test(text));
  const off = prefix !== "" && all.every((line) => has(line.text));
  let number = 0;
  const changes = state.changes(
    all.map((line) => {
      const m = PREFIX.exec(line.text)!;
      const indent = m[1];
      const next =
        off || prefix === "" ? "" : prefix === "1. " ? `${++number}. ` : prefix;
      return {
        from: line.from + indent.length,
        to: line.from + m[0].length,
        insert: next,
      };
    }),
  );
  // A caret where the prefix goes lands after it, not before: typing went
  // in front of a new "### " on an empty line.
  view.dispatch({ changes, selection: state.selection.map(changes, 1) });
  return true;
}

/** A link around the selection, its address selected to be typed. */
export function insertSourceLink(view: EditorView): void {
  const { state } = view;
  const range = state.selection.main;
  const text = state.sliceDoc(range.from, range.to);
  const insert = `[${text}]()`;
  const at = range.from + text.length + 3;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: at },
  });
}

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;

/** The code fence holding line `at` (1-based), as its opening and closing
 *  line numbers; null outside one, or in one never closed. Read from the
 *  document's start, as Markdown reads it: a closing fence is of the opening
 *  one's character, as long at least, with nothing after it. */
function fenceAround(
  doc: EditorState["doc"],
  at: number,
): { open: number; close: number } | null {
  let open: { line: number; marks: string } | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const found = FENCE.exec(doc.line(n).text);
    if (!found) continue;
    const [, marks, rest] = found;
    if (!open) {
      if (n > at) return null;
      open = { line: n, marks };
    } else if (
      marks[0] === open.marks[0] &&
      marks.length >= open.marks.length &&
      !rest.trim()
    ) {
      if (n >= at) return { open: open.line, close: n };
      open = null;
    }
  }
  return null;
}

/** The selected lines in a code fence, or the fence around them taken off. */
export function toggleSourceFence(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  const first = state.doc.lineAt(range.from);
  const last = state.doc.lineAt(range.to);
  const around = fenceAround(state.doc, first.number);
  if (around && around.close >= last.number) {
    // Each fence line with its line break; the last line has none after.
    const whole = (n: number) => {
      const line = state.doc.line(n);
      return n < state.doc.lines
        ? { from: line.from, to: line.to + 1 }
        : { from: Math.max(0, line.from - 1), to: line.to };
    };
    const changes = state.changes([whole(around.open), whole(around.close)]);
    view.dispatch({ changes, selection: state.selection.map(changes, 1) });
    return true;
  }
  const changes = state.changes([
    { from: first.from, insert: "```\n" },
    { from: last.to, insert: "\n```" },
  ]);
  view.dispatch({ changes, selection: state.selection.map(changes, 1) });
  return true;
}
