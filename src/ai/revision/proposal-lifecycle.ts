import type { PendingStatus } from "./usePendingEdits";

/** A proposal's status: live (read off its preview) while in the document,
 *  else recorded by call id so a card never falls back to "Pending". */

export type RecordedStatus = Exclude<PendingStatus, "pending" | "streaming">;

export type ProposalEvent =
  /** The writer, or a later request, decided on it. */
  | { type: "decided"; outcome: RecordedStatus }
  /** Its preview left the document without a decision recorded: written
   *  in (an Accept's own transaction) or not - the text under it changed. */
  | { type: "dropped"; applied: boolean }
  /** An undo put an accepted proposal back on offer. */
  | { type: "back" }
  /** A redo applied it again. */
  | { type: "applied" };

/** The recorded status after `event`; null when it is live again. */
export function recordStatus(
  status: RecordedStatus | undefined,
  event: ProposalEvent,
): RecordedStatus | null {
  switch (event.type) {
    case "decided":
      return event.outcome;
    case "dropped":
      return status ?? (event.applied ? "accepted" : "invalid");
    case "back":
      return status === "accepted" ? null : (status ?? null);
    case "applied":
      return "accepted";
  }
}

/** `recordStatus` over a record, for these call ids; the same record when
 *  nothing moved. */
export function recordStatuses(
  record: Record<string, RecordedStatus>,
  ids: Iterable<string>,
  event: ProposalEvent,
): Record<string, RecordedStatus> {
  let next: Record<string, RecordedStatus> | null = null;
  for (const id of ids) {
    const status = recordStatus(record[id], event);
    if (status === (record[id] ?? null)) continue;
    next ??= { ...record };
    if (status) next[id] = status;
    else delete next[id];
  }
  return next ?? record;
}

/** A proposal whose preview is in the document. */
export function liveStatus(preview: { streaming?: boolean }): PendingStatus {
  return preview.streaming ? "streaming" : "pending";
}
