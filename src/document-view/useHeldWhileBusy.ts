import { useEffect } from "react";
import { setEditorHeld } from "../document/editor-held";
import type { PendingStatus } from "../ai/revision/usePendingEdits";

/** Keeps a hidden tab's editor loaded while Quick Ask lives in it or
 *  Textus AI is still writing into it. Revisions waiting to be decided
 *  don't hold it: they are kept with the file and come back on open. */
export function useHeldWhileBusy({
  tabId,
  quickAsk,
  quickAskOpen,
  writing,
  statuses,
}: {
  tabId: string;
  quickAsk: { busy: boolean; history: readonly unknown[] };
  quickAskOpen: boolean;
  /** Its conversation's reply still coming: its proposals land here. */
  writing: boolean;
  statuses: Record<string, PendingStatus>;
}): void {
  const held =
    quickAskOpen ||
    quickAsk.busy ||
    quickAsk.history.length > 0 ||
    writing ||
    Object.values(statuses).some((s) => s === "streaming");
  useEffect(() => {
    setEditorHeld(tabId, held);
  }, [tabId, held]);
  useEffect(() => () => setEditorHeld(tabId, false), [tabId]);
}
