import type { RevisionDisplay } from "../../prefs/SettingsContext";
import {
  reviewChanges,
  type PendingPreview,
  type PendingSentence,
} from "../revision/pending-types";
import { addsTextOnly } from "../revision/revision-display";
import type { usePendingEdits } from "../revision/usePendingEdits";
import type { MarginItem } from "./margin-layout";
import { OWN_CHANGES } from "./own-revision-plugin";
import type { ReviewNote } from "./review-notes-plugin";
import type { useOwnRevisions } from "./useOwnRevisions";

type Edits = ReturnType<typeof usePendingEdits>;

/** A proposal shown whole as a margin card's change: what it replaces and
 *  with what. Null for new text alone, which has no original. */
function wholeChange(p: PendingPreview): PendingSentence | null {
  const { action, anchor, text } = p.proposal;
  // New text alone: nothing replaced, so no original.
  if (addsTextOnly(p.proposal))
    return {
      from: p.from,
      to: p.from,
      before: "",
      after: text ?? "",
      take: null,
    };
  if (
    action !== "replace" &&
    action !== "replace_selection" &&
    action !== "delete"
  )
    return null;
  return {
    from: p.strikeFrom ?? p.from,
    to: p.strikeTo ?? p.to,
    before: anchor ?? p.expectedText,
    after: action === "delete" ? "" : (text ?? ""),
    take: null,
  };
}

/** The margin's cards: the notes, then each pending sentence in the review
 *  bar's order, then the writer's own tracked changes. */
export function marginItemsOf(
  notes: readonly ReviewNote[],
  stops: Edits["reviewStops"],
  reviewed: Edits["reviewed"],
  display: RevisionDisplay,
  own: ReturnType<typeof useOwnRevisions>["changes"],
): MarginItem[] {
  const items: MarginItem[] = notes.map((note) => ({
    kind: "note",
    key: `note:${note.id}`,
    note,
  }));
  stops.forEach((stop, i) => {
    if (display === "inline") return;
    const preview = reviewed.find((p) => p.callId === stop.callId);
    if (!preview) return;
    const c =
      stop.index < 0
        ? wholeChange(preview)
        : reviewChanges(preview)?.[stop.index];
    if (!c) return;
    items.push({
      kind: "revision",
      key: `rev:${stop.callId}:${stop.index}`,
      callId: stop.callId,
      index: stop.index,
      num: i + 1,
      from: c.from,
      to: c.to,
      after: c.after,
      before: c.before,
      shows: display === "final" ? "new" : "original",
      take: c.take,
      streaming: !!preview.streaming,
    });
  });
  // The writer's own tracked changes, as the AI's: in the margin views a
  // card shows what the text doesn't; inline, all is in the text.
  if (display !== "inline")
    (own ?? []).forEach((c, i) =>
      items.push({
        kind: "revision",
        key: `rev:${OWN_CHANGES}:${c.index}`,
        callId: OWN_CHANGES,
        index: c.index,
        num: i + 1,
        from: c.from,
        to: c.to,
        after: c.after,
        before: c.before,
        shows: display === "original" ? "original" : "new",
        take: null,
        streaming: false,
      }),
    );
  return items;
}
