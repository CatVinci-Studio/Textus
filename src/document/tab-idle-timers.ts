/**
 * One idle timer per tab, for writes made once typing rests. `schedule`
 * skips a snapshot equal (`same`) to the pending one; `maxWaitMs` caps how
 * long a typing burst holds a write off.
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
