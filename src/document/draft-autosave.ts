import { useEffect, useRef, useState } from "react";
import { tabIsDirty, type DocTab } from "./doc-tabs";
import { createTabIdleTimers } from "./tab-idle-timers";
import { drafts } from "../platform/ipc";

const DEBOUNCE_MS = 3000;
const MAX_WAIT_MS = 30000;

interface Snapshot {
  content: string;
  path: string | null;
}

/**
 * Best-effort crash/force-quit recovery (2.4): every dirty tab's content is
 * snapshotted to disk a few seconds after typing settles, or at least every
 * 30s during a long unbroken typing burst. A tab drops out of tracking the
 * moment it becomes clean (saved) or disappears from `tabs` (closed, or
 * handed off to another window in a tab drag) - in every case its on-disk
 * snapshot is cleared, since whatever it protected against has been
 * resolved one way or another. Restoring these at startup is App.tsx's job
 * (see the mount-time drain effect); this hook only ever writes.
 *
 * `enabled` is Settings > Privacy > Draft Recovery - while off, no new
 * snapshots are scheduled (existing on-disk ones are left as they are; the
 * privacy section's own "Clear" button is what removes them).
 *
 * Returns a cancel function that drops every scheduled-but-unflushed
 * snapshot write. For the window-teardown paths in app/close-flow.ts
 * (whole-window close, last-tab removeTab): those clear the on-disk
 * snapshots and then destroy() the window, and a debounce timer firing in
 * that gap would silently re-save what was just cleared - resurrecting a
 * discarded document as a "recovered draft" on the next launch.
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
        { content: tab.content, path: tab.path },
        ({ content, path }) =>
          void drafts.saveDraftSnapshot(tab.id, path, content),
      );
    }
  }, [tabs, enabled, cancel, timers]);

  return cancel;
}
