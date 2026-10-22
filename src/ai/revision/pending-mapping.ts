import type { Transaction } from "@milkdown/kit/prose/state";
import { isHistoryTransaction } from "@milkdown/kit/prose/history";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { visibleTextBetween } from "../../editor/markdown/link-reveal";
import type {
  AppliedEdit,
  PendingPreview,
  PendingSentence,
  PendingState,
} from "./pending-types";
import { animations } from "./pending-animation";

/**
 * Proposals kept in place as the document changes: previews mapped
 * through each transaction, rebased over the writer's own edits, their
 * streamed changes and undo history kept in step (pending-edit-plugin.ts).
 */

/** Accepts remembered for undo - older ones are rarely undone that far. */
export const MAX_APPLIED = 20;

/** An undo or redo landing exactly on an accept's before or after: the
 *  preview comes back or goes again. Null when nothing matched. */
export function replayHistory(
  tr: Transaction,
  prev: PendingState,
): { previews: PendingPreview[]; applied: AppliedEdit[] } | null {
  if (!isHistoryTransaction(tr) || prev.applied.length === 0) return null;
  const back: PendingPreview[] = [];
  const gone = new Set<string>();
  const applied = prev.applied.map((entry) => {
    if (!entry.undone && tr.doc.eq(entry.before)) {
      back.push(entry.preview);
      return { ...entry, undone: true };
    }
    if (entry.undone && tr.doc.eq(entry.after)) {
      gone.add(entry.preview.callId);
      return { ...entry, undone: false };
    }
    return entry;
  });
  if (back.length === 0 && gone.size === 0) return null;
  // The others move with the undo, as with any edit; the restored ones were
  // recorded against exactly this document.
  const others = mapPreviews(
    prev.previews.filter(
      (p) => !gone.has(p.callId) && !back.some((b) => b.callId === p.callId),
    ),
    tr,
  ).survivors;
  return { previews: [...others, ...back], applied };
}

/**
 * The previews carried through a document change: each range (strike
 * included) mapped through the transaction, and any whose mapped range no
 * longer holds the text it was resolved against dropped - an edit inside
 * or around a pending change invalidates it rather than risk applying it
 * to the wrong text later. `changed` says whether anything moved or went.
 */
export function mapPreviews(
  previews: PendingPreview[],
  tr: Transaction,
): { survivors: PendingPreview[]; changed: boolean } {
  let changed = false;
  const survivors: PendingPreview[] = [];
  const range = (r: { from: number; to: number }) => ({
    from: tr.mapping.map(r.from, -1),
    to: tr.mapping.map(r.to, 1),
  });
  const mapChange = (c: PendingSentence): PendingSentence => ({
    ...c,
    ...range(c),
    parts: c.parts?.map(range),
    at: c.at === undefined ? undefined : tr.mapping.map(c.at, -1),
  });
  for (const p of previews) {
    const from = tr.mapping.map(p.from, -1);
    const to = tr.mapping.map(p.to, 1);
    if (from > to) {
      changed = true;
      continue;
    }
    const text = visibleTextBetween(tr.doc, from, to, " ");
    // Typing elsewhere: the same preview, so nothing is redrawn.
    if (text === p.expectedText && from === p.from && to === p.to) {
      survivors.push(p);
      continue;
    }
    changed = true;
    const mapped: PendingPreview = {
      ...p,
      from,
      to,
      strikeFrom:
        p.strikeFrom === undefined
          ? undefined
          : tr.mapping.map(p.strikeFrom, -1),
      strikeTo:
        p.strikeTo === undefined ? undefined : tr.mapping.map(p.strikeTo, 1),
      sentences: p.sentences && {
        hunks: p.sentences.hunks,
        changes: p.sentences.changes.map(mapChange),
        parked: p.sentences.parked?.map(mapChange),
      },
      streamSource: p.streamSource && {
        sentences: p.streamSource.sentences,
        ranges: p.streamSource.ranges.map((r) => ({ ...r, ...range(r) })),
      },
    };
    if (text === p.expectedText) {
      survivors.push(mapped);
      continue;
    }
    const kept = rebase(mapped, tr.doc, text);
    if (kept) survivors.push(kept);
  }
  return { survivors, changed };
}

/**
 * A preview whose text the writer changed (`text`, as it now reads),
 * carried on rather than dropped where that can be done without touching
 * what they wrote - null where it can't:
 *
 * - decided sentence by sentence: each change stands while its own
 *   original reads as it did; one whose original they changed is set aside
 *   (`parked`), and back if it reads so again (an undo); none left, it goes;
 * - still streaming in, a rewrite: its original's ranges follow the edit,
 *   and the completed call is found again sentence by sentence against the
 *   text as it then is (usePendingEdits' `rebasedSentences`).
 *
 * Anything else - shown and decided whole - goes, as before: its Accept
 * writes the whole range, the writer's edit with it.
 */
export function rebase(
  p: PendingPreview,
  doc: ProseNode,
  text: string,
): PendingPreview | null {
  if (p.proposal.action !== "replace") return null;
  if (p.streaming) {
    if (!p.streamSource) return null;
    return { ...p, expectedText: text, rebased: true };
  }
  const s = p.sentences;
  if (!s || !s.changes.every((c) => c.expected !== undefined)) return null;
  const stands = (c: PendingSentence) =>
    c.from <= c.to &&
    c.to <= doc.content.size &&
    visibleTextBetween(doc, c.from, c.to, " ") === c.expected;
  const all = [...s.changes, ...(s.parked ?? [])].sort(
    (a, b) => a.from - b.from,
  );
  const changes = all.filter(stands);
  if (changes.length === 0) return null;
  return {
    ...p,
    expectedText: text,
    rebased: true,
    sentences: {
      hunks: s.hunks,
      changes,
      parked: all.filter((c) => !changes.includes(c)),
    },
  };
}

/** The previews with each streaming rewrite's completed changes as last
 *  drawn (PendingPreview.streamChanges): a new preview only when they
 *  changed, so React hears of each change as it completes, not of every
 *  frame of the sentence being written. */
export function withStreamChanges(
  previews: PendingPreview[],
): PendingPreview[] {
  let out: PendingPreview[] | null = null;
  previews.forEach((p, i) => {
    const changes = p.streaming
      ? animations.get(p.callId)?.stream?.changes
      : undefined;
    if (!changes || sameChanges(changes, p.streamChanges)) return;
    out ??= previews.slice();
    out[i] = { ...p, streamChanges: changes };
  });
  return out ?? previews;
}

export function sameChanges(
  a: PendingSentence[],
  b: PendingSentence[] | undefined,
) {
  return (
    b !== undefined &&
    a.length === b.length &&
    a.every(
      (c, i) =>
        c.from === b[i].from &&
        c.to === b[i].to &&
        c.at === b[i].at &&
        c.before === b[i].before &&
        c.after === b[i].after,
    )
  );
}
