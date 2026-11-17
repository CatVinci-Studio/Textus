import { useEffect } from "react";
import { registerTabEditor } from "../editor/tab-editor";
import type { PendingStatus } from "../ai/revision/usePendingEdits";

interface Busy {
  quickAsk: { busy: boolean; history: readonly unknown[] };
  quickAskOpen: boolean;
  /** Its conversation's reply still coming: its proposals land here. */
  writing: boolean;
  statuses: Record<string, PendingStatus>;
  /** No file yet: nothing its undecided proposals can be kept with. */
  filePath: string | null;
}

/** Whether a tab's editor stays loaded out of sight: Quick Ask lives in it,
 *  or Textus AI is still writing into it. Revisions waiting to be decided
 *  don't hold it - they are kept with the file and come back on open -
 *  except in a document with no file. */
export function heldWhileBusy({
  quickAsk,
  quickAskOpen,
  writing,
  statuses,
  filePath,
}: Busy): boolean {
  const of = Object.values(statuses);
  return (
    quickAskOpen ||
    quickAsk.busy ||
    quickAsk.history.length > 0 ||
    writing ||
    of.includes("streaming") ||
    (!filePath && of.includes("pending"))
  );
}

export function useHeldWhileBusy({
  tabId,
  ...busy
}: Busy & { tabId: string }): void {
  const held = heldWhileBusy(busy);
  useEffect(
    () => (held ? registerTabEditor(tabId, "held", true) : undefined),
    [tabId, held],
  );
}
