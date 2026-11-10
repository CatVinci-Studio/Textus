import { useEffect } from "react";
import { setEditorHeld } from "../document/editor-held";
import { undecidedIn } from "../document/undecided";
import type { PendingStatus } from "../ai/revision/usePendingEdits";

/** Keeps a hidden tab's editor loaded while Quick Ask or a proposal of
 *  Textus AI's lives in it, or changes in it wait to be decided. */
export function useHeldWhileBusy({
  tabId,
  filePath,
  quickAsk,
  quickAskOpen,
  statuses,
}: {
  tabId: string;
  filePath: string | null;
  quickAsk: { busy: boolean; history: readonly unknown[] };
  quickAskOpen: boolean;
  statuses: Record<string, PendingStatus>;
}): void {
  const held =
    quickAskOpen ||
    quickAsk.busy ||
    quickAsk.history.length > 0 ||
    Object.values(statuses).some((s) => s === "pending" || s === "streaming") ||
    (filePath !== null && undecidedIn(filePath) > 0);
  useEffect(() => {
    setEditorHeld(tabId, held);
  }, [tabId, held]);
  useEffect(() => () => setEditorHeld(tabId, false), [tabId]);
}
