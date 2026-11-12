import { useEffect, useRef, useState } from "react";
import { tabIsDirty, type DocTab } from "./doc-tabs";
import { createTabIdleTimers } from "./tab-idle-timers";
import { drafts } from "../platform/ipc";
import { listenToThisWindow, unlistenAll } from "../platform/events";

const DEBOUNCE_MS = 3000;
const MAX_WAIT_MS = 30000;

interface Snapshot {
  content: string;
  path: string | null;
  diskMtime: number | null;
}

/**
 * Crash recovery: every dirty tab is snapshotted a few seconds after typing
 * settles, or every 30s during a long burst; the snapshot is cleared when the
 * tab is saved or leaves. `enabled` off schedules no new snapshots. Returns a
 * cancel for window teardown, where a late timer would resurrect a
 * discarded document.
 */
export function useDraftAutosave(tabs: DocTab[], enabled: boolean): () => void {
  const [timers] = useState(() =>
    createTabIdleTimers<Snapshot>({
      idleMs: DEBOUNCE_MS,
      maxWaitMs: MAX_WAIT_MS,
      same: (a, b) => a.content === b.content && a.path === b.path,
    }),
  );
  const knownIdsRef = useRef<Set<string>>(new Set());
  const cancel = timers.cancelAll;

  useEffect(() => cancel, [cancel]);
  // An update about to end the app (Windows): what waits is written now.
  useEffect(
    () => unlistenAll(listenToThisWindow("flush-drafts", timers.flushAll)),
    [timers],
  );

  useEffect(() => {
    const seenIds = new Set(tabs.map((tab) => tab.id));

    for (const id of knownIdsRef.current) {
      if (seenIds.has(id)) continue;
      timers.cancel(id);
      void drafts.clearDraftSnapshot(id);
    }
    knownIdsRef.current = seenIds;

    if (!enabled) {
      cancel();
      return;
    }

    for (const tab of tabs) {
      if (!tabIsDirty(tab)) {
        if (timers.cancel(tab.id)) void drafts.clearDraftSnapshot(tab.id);
        continue;
      }
      timers.schedule(
        tab.id,
        { content: tab.content, path: tab.path, diskMtime: tab.diskMtime },
        ({ content, path, diskMtime }) =>
          void drafts.saveDraftSnapshot(tab.id, path, content, diskMtime),
      );
    }
  }, [tabs, enabled, cancel, timers]);

  return cancel;
}
