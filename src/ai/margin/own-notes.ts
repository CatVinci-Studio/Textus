import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { ReviewNote } from "./review-notes-plugin";

/** A writer's note as kept: its words plus a little text before them, to tell
 *  repeats apart. No positions, as the file can change outside Textus. */
export interface StoredOwnNote {
  id: string;
  comment: string;
  anchor: string;
  before: string;
}

/** How much of the paragraph before a note is kept to find it again by. */
const BEFORE = 32;

/** The notes in a kept file; anything else in it is left out. */
export function parseOwnNotes(text: string | null): StoredOwnNote[] {
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((n) =>
      n &&
      typeof n.id === "string" &&
      typeof n.comment === "string" &&
      typeof n.anchor === "string" &&
      n.anchor &&
      typeof n.before === "string"
        ? [
            {
              id: n.id,
              comment: n.comment,
              anchor: n.anchor,
              before: n.before,
            },
          ]
        : [],
    );
  } catch {
    return [];
  }
}

/** A note placed in `doc`, as it is kept. */
export function storedOwnNote(doc: ProseNode, note: ReviewNote): StoredOwnNote {
  const $from = doc.resolve(note.from);
  const start = $from.start();
  return {
    id: note.id,
    comment: note.comment,
    anchor: doc.textBetween(note.from, note.to, "\n", "\n"),
    before: doc.textBetween(start, note.from, "\n", "\n").slice(-BEFORE),
  };
}

/** Where a passage sits inside one paragraph: offsets of its text (as
 *  textBetween reads it) turned into document positions. */
function positionsIn(
  block: ProseNode,
  blockStart: number,
  start: number,
  end: number,
): { from: number; to: number } {
  let consumed = 0;
  let from = blockStart;
  let to = blockStart;
  block.forEach((child, offset) => {
    const len = child.isText ? child.text!.length : child.isLeaf ? 1 : 0;
    const pos = blockStart + offset;
    if (start >= consumed && start <= consumed + len)
      from = pos + (start - consumed);
    if (end >= consumed && end <= consumed + len) to = pos + (end - consumed);
    consumed += len;
  });
  return { from, to };
}

/** Where a kept note is in `doc` now: its words where the text before them
 *  matches most, else their first occurrence; null when absent. */
export function locateOwnNote(
  doc: ProseNode,
  note: StoredOwnNote,
): { from: number; to: number } | null {
  let best: { from: number; to: number; score: number } | null = null;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, "\n", "\n");
    for (
      let at = text.indexOf(note.anchor);
      at !== -1;
      at = text.indexOf(note.anchor, at + 1)
    ) {
      const before = text.slice(Math.max(0, at - note.before.length), at);
      let score = 0;
      while (
        score < before.length &&
        before[before.length - 1 - score] ===
          note.before[note.before.length - 1 - score]
      )
        score++;
      if (!best || score > best.score)
        best = {
          ...positionsIn(node, pos + 1, at, at + note.anchor.length),
          score,
        };
    }
    return false;
  });
  const found = best as { from: number; to: number; score: number } | null;
  return found ? { from: found.from, to: found.to } : null;
}
