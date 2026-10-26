import type { EditorState } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";

// The text around the caret, flattened (a line per text block), and where
// the editing actions of a plugin that has the keyboard (editor-input.ts)
// move to in it: words, lines, the character found.

export interface Flat {
  text: string;
  /** The document position before each character; a block boundary's
   *  "\n" maps to the end of the block before it. */
  pos: number[];
  /** The position after the last character. */
  end: number;
  /** The index each text block starts at, in order. */
  starts: number[];
}

export function flatten(doc: ProseNode, from: number, to: number): Flat {
  let text = "";
  const pos: number[] = [];
  const starts: number[] = [];
  let end = from;
  let first = true;
  doc.nodesBetween(from, to, (node, at) => {
    if (node.isTextblock) {
      if (!first) {
        text += "\n";
        pos.push(end);
      }
      first = false;
      starts.push(text.length);
      end = at + 1;
      return true;
    }
    if (node.isText) {
      const start = Math.max(from, at);
      const stop = Math.min(to, at + node.nodeSize);
      for (let p = start; p < stop; p++) {
        text += node.text![p - at];
        pos.push(p);
      }
      end = stop;
      return false;
    }
    if (node.isInline && node.isLeaf) {
      // A picture, a hard break: one character's room.
      text +=
        node.type.name === "hardbreak" || node.type.name === "hard_break"
          ? "\n"
          : "￼";
      pos.push(at);
      end = at + node.nodeSize;
    }
    return true;
  });
  return { text, pos, end, starts };
}

/** The index in `flat` of document position `p` (the character after it). */
export function indexOf(flat: Flat, p: number): number {
  let lo = 0;
  let hi = flat.pos.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (flat.pos[mid] < p) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function posOf(flat: Flat, i: number): number {
  if (i >= flat.pos.length) return flat.end;
  return flat.pos[Math.max(0, i)];
}

/** The text around `p`, far enough for any one motion. */
export function around(state: EditorState, p: number, reach = 20_000): Flat {
  const size = state.doc.content.size;
  return flatten(state.doc, Math.max(0, p - reach), Math.min(size, p + reach));
}

type CharClass = 0 | 1 | 2;
function charClass(ch: string | undefined): CharClass {
  if (!ch || /\s/.test(ch)) return 0;
  if (/[\p{L}\p{N}_]/u.test(ch)) return 2;
  return 1;
}

export function lineStartIndex(text: string, i: number): number {
  const at = text.lastIndexOf("\n", i - 1);
  return at + 1;
}
export function lineEndIndex(text: string, i: number): number {
  const at = text.indexOf("\n", i);
  return at < 0 ? text.length : at;
}

/** Where a motion from index `i` lands, in `flat`. */
export function motion(
  flat: Flat,
  i: number,
  unit: string,
  arg: { char?: string; forward?: boolean; till?: boolean },
): number {
  const t = flat.text;
  switch (unit) {
    case "left":
      return i > lineStartIndex(t, i) ? i - 1 : i;
    case "right": {
      const end = lineEndIndex(t, i);
      return i < end - 1 ? i + 1 : i;
    }
    case "rightInsert": {
      const end = lineEndIndex(t, i);
      return i < end ? i + 1 : i;
    }
    // A character on, or back, across the end of a line too (Emacs's C-f
    // and C-b).
    case "charForward":
      return Math.min(i + 1, t.length);
    case "charBack":
      return Math.max(i - 1, 0);
    case "wordStart": {
      let j = i;
      const c = charClass(t[j]);
      while (j < t.length && charClass(t[j]) === c && c !== 0) j++;
      while (j < t.length && charClass(t[j]) === 0) j++;
      return Math.min(j, t.length);
    }
    // An operator's w (Vim's dw, yw): to the next word, but not past the
    // end of this line - the last word's dw doesn't join two blocks.
    case "wordStartInLine": {
      const j = motion(flat, i, "wordStart", arg);
      const end = lineEndIndex(t, i);
      return end > i && end < j ? end : j;
    }
    case "wordEnd": {
      let j = i + 1;
      while (j < t.length && charClass(t[j]) === 0) j++;
      const c = charClass(t[j]);
      while (j + 1 < t.length && charClass(t[j + 1]) === c) j++;
      return Math.min(j, Math.max(0, t.length - 1));
    }
    case "wordBack": {
      let j = i - 1;
      while (j > 0 && charClass(t[j]) === 0) j--;
      const c = charClass(t[j]);
      while (j > 0 && charClass(t[j - 1]) === c) j--;
      return Math.max(0, j);
    }
    case "lineStart":
      return lineStartIndex(t, i);
    case "lineFirstChar": {
      let j = lineStartIndex(t, i);
      while (j < t.length && t[j] !== "\n" && /\s/.test(t[j])) j++;
      return j;
    }
    case "lineEnd": {
      const end = lineEndIndex(t, i);
      return Math.max(lineStartIndex(t, i), end - 1);
    }
    case "lineEndInsert":
      return lineEndIndex(t, i);
    // A Markdown document has no blank lines between its paragraphs: }
    // goes to the start of the next block, { to the start of this one (or
    // the one before, from its start), and an operator's } to the end of
    // this one.
    case "paragraphNext":
      return flat.starts.find((s) => s > i) ?? t.length;
    case "paragraphPrev":
      return [...flat.starts].reverse().find((s) => s < i) ?? 0;
    case "paragraphEnd": {
      const next = flat.starts.find((s) => s > i);
      return next === undefined ? t.length : next - 1;
    }
    case "findChar": {
      const ch = arg.char ?? "";
      if (!ch) return i;
      if (arg.forward !== false) {
        const end = lineEndIndex(t, i);
        const at = t.indexOf(ch, i + 1 + (arg.till ? 1 : 0));
        if (at < 0 || at >= end) return i;
        return arg.till ? at - 1 : at;
      }
      const start = lineStartIndex(t, i);
      const at = t.lastIndexOf(ch, i - 1 - (arg.till ? 1 : 0));
      if (at < start) return i;
      return arg.till ? at + 1 : at;
    }
  }
  return i;
}

/** The text block around `p`: its first and last positions. */
function textblockAt(doc: ProseNode, p: number): { from: number; to: number } {
  const $p = doc.resolve(p);
  let depth = $p.depth;
  while (depth > 0 && !$p.node(depth).isTextblock) depth--;
  return depth > 0
    ? { from: $p.start(depth), to: $p.end(depth) }
    : { from: p, to: p };
}

/** The text block after (`dir` 1) or before (-1) the one from `from` to
 *  `to`, if there is one. */
function textblockBeside(
  doc: ProseNode,
  from: number,
  to: number,
  dir: 1 | -1,
): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  const [a, b] = dir > 0 ? [to, doc.content.size] : [0, from];
  doc.nodesBetween(a, b, (node, at) => {
    if (dir > 0 && found) return false;
    if (!node.isTextblock) return true;
    const block = { from: at + 1, to: at + 1 + node.content.size };
    if (dir > 0 ? block.from > to : block.to < from) found = block;
    return false;
  });
  return found;
}

/** The first position from `lo` to `hi` (both in) whose line starts below
 *  `y` - the positions are in one text block, their lines in order -, or
 *  `hi + 1` if none does. */
function firstBelow(view: EditorView, lo: number, hi: number, y: number) {
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (view.coordsAtPos(mid, 1).top > y) hi = mid - 1;
    else lo = mid + 1;
  }
  return lo;
}

/** In the line from `from` (its first position) of the text block ending
 *  at `blockEnd`, the position nearest `x`. */
function nearestInLine(
  view: EditorView,
  from: number,
  blockEnd: number,
  x: number,
): number {
  const first = view.coordsAtPos(from, 1);
  const half = Math.max(4, (first.bottom - first.top) / 2);
  const end = firstBelow(view, from, blockEnd, first.top + half) - 1;
  let best = from;
  let gap = Infinity;
  for (let p = from; p <= end; p++) {
    const d = Math.abs(view.coordsAtPos(p, 1).left - x);
    if (d < gap) {
      gap = d;
      best = p;
    }
  }
  return best;
}

/** Where a move a line down (`dir` 1) or up (-1) from `head` lands,
 *  nearest the column `x`: the next line of the paragraph as it is shown
 *  (a long one wraps), or of a code block, else the first (last) line of
 *  the text block after (before) it - whatever is between them, a code
 *  block's frame, a picture, a rule. Measured from the document, not the
 *  screen, so off-screen lines are reached too. */
export function verticalMove(
  view: EditorView,
  head: number,
  dir: 1 | -1,
  x: number,
): number {
  const { doc } = view.state;
  const block = textblockAt(doc, head);
  const at = view.coordsAtPos(head, 1);
  const half = Math.max(4, (at.bottom - at.top) / 2);
  if (dir > 0) {
    const next = firstBelow(view, head, block.to, at.top + half);
    if (next <= block.to) return nearestInLine(view, next, block.to, x);
    const after = textblockBeside(doc, block.from, block.to, 1);
    return after ? nearestInLine(view, after.from, after.to, x) : head;
  }
  // Up: the line before this one in the block, else the last line of the
  // block before.
  const lineStart = firstBelow(view, block.from, head, at.top - half);
  if (lineStart > block.from) {
    const prevTop = view.coordsAtPos(lineStart - 1, 1).top;
    const start = firstBelow(view, block.from, lineStart - 1, prevTop - half);
    return nearestInLine(view, start, block.to, x);
  }
  const before = textblockBeside(doc, block.from, block.to, -1);
  if (!before) return head;
  const lastTop = view.coordsAtPos(before.to, -1).top;
  const start = firstBelow(view, before.from, before.to, lastTop - half);
  return nearestInLine(view, start, before.to, x);
}

/** Lines covering the selection's head, `count` of them: their range and
 *  text, each a text block (a code block's lines, there). */
export function linesRange(
  state: EditorState,
  count: number,
): { from: number; to: number; text: string; blocks: boolean } {
  const { $head } = state.selection;
  let depth = $head.depth;
  while (depth > 0 && !$head.node(depth).isTextblock) depth--;
  const block = $head.node(depth);
  if (block.type.spec.code) {
    // A code block: its own lines.
    const start = $head.start(depth);
    const text = block.textContent;
    const offset = $head.pos - start;
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
    let lineEnd = lineStart;
    for (let n = 0; n < count; n++) {
      const next = text.indexOf("\n", lineEnd);
      lineEnd = next < 0 ? text.length : next + (n < count - 1 ? 1 : 0);
      if (next < 0) break;
    }
    const from = start + lineStart;
    const to = start + lineEnd;
    const withBreak = lineEnd < text.length ? to + 1 : to;
    return {
      from: lineStart > 0 && withBreak === to ? from - 1 : from,
      to: withBreak,
      text: text.slice(lineStart, lineEnd) + "\n",
      blocks: false,
    };
  }
  const from = $head.before(depth);
  let to = $head.after(depth);
  const texts = [block.textContent];
  for (let n = 1; n < count; n++) {
    const next = state.doc.resolve(Math.min(to + 1, state.doc.content.size));
    let d = next.depth;
    while (d > 0 && !next.node(d).isTextblock) d--;
    if (d === 0 || next.before(d) < to) break;
    texts.push(next.node(d).textContent);
    to = next.after(d);
  }
  return { from, to, text: texts.join("\n") + "\n", blocks: true };
}

export function selectionText(state: EditorState): string {
  const { from, to } = state.selection;
  return state.doc.textBetween(from, to, "\n", "￼");
}
