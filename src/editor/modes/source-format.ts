import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

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
      if (
        text.length >= 2 * n &&
        text.startsWith(marker) &&
        text.endsWith(marker)
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
  for (const range of state.selection.ranges)
    for (
      let at = state.doc.lineAt(range.from).number;
      at <= state.doc.lineAt(range.to).number;
      at++
    )
      lines.add(at);
  const all = [...lines].map((at) => state.doc.line(at));
  // Taken off when every line has it; else every line gets it.
  const has = (text: string) =>
    (PREFIX.exec(text)?.[2] ?? "").replace(/\s+$/, " ") === prefix ||
    (prefix === "1. " && /^\s*\d+[.)]\s/.test(text));
  const off = prefix !== "" && all.every((line) => has(line.text));
  let number = 0;
  view.dispatch({
    changes: all.map((line) => {
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
  });
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
