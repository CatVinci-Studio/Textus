/**
 * One idle timer per tab, for the two things written once typing rests:
 * draft snapshots (draft-autosave.ts) and Save Automatically (autosave.ts).
 *
 * `schedule` (re)starts a tab's timer for a snapshot of it, unless the
 * timer already stands for an equal one (`same`) - a re-render that changed
 * nothing doesn't push the write back. `maxWaitMs` caps how long one
 * unbroken typing burst can hold a write off; the cap restarts after each
 * write. A tab's entry stays after its timer fires, so an unchanged
 * snapshot isn't written twice; `cancel` drops it.
 */
export interface TabIdleTimers<S> {
  schedule: (id: string, snapshot: S, fire: (snapshot: S) => void) => void;
  /** Drops a tab's timer and entry; true when it had one. */
  cancel: (id: string) => boolean;
  cancelAll: () => void;
  ids: () => string[];
}

export function createTabIdleTimers<S>(opts: {
  idleMs: number;
  maxWaitMs?: number;
  same: (a: S, b: S) => boolean;
}): TabIdleTimers<S> {
  const { idleMs, maxWaitMs = Infinity, same } = opts;
  const pending = new Map<
    string,
    { snapshot: S; timer: ReturnType<typeof setTimeout>; firstAt: number }
  >();

  const cancel = (id: string) => {
    const entry = pending.get(id);
    if (entry) clearTimeout(entry.timer);
    return pending.delete(id);
  };

  return {
    schedule(id, snapshot, fire) {
      const existing = pending.get(id);
      if (existing && same(existing.snapshot, snapshot)) return;
      if (existing) clearTimeout(existing.timer);
      const firstAt = existing?.firstAt ?? Date.now();
      const delay = Math.max(
        0,
        Math.min(idleMs, maxWaitMs - (Date.now() - firstAt)),
      );
      const timer = setTimeout(() => {
        const entry = pending.get(id);
        if (entry) entry.firstAt = Date.now();
        fire(snapshot);
      }, delay);
      pending.set(id, { snapshot, timer, firstAt });
    },
    cancel,
    cancelAll() {
      for (const id of [...pending.keys()]) cancel(id);
    },
    ids: () => [...pending.keys()],
  };
}
