/** Who listens to a module's own state, told when it changes: what
 *  useSyncExternalStore subscribes to. */
export function createSubscribers(): {
  subscribe: (listener: () => void) => () => void;
  publish: () => void;
} {
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    publish: () => {
      for (const listener of [...listeners]) listener();
    },
  };
}

/** Requests shown one at a time, oldest first: a dialog's queue. */
export function createRequestQueue<R extends { id: number }>() {
  const { subscribe, publish } = createSubscribers();
  let nextId = 1;
  let queue: readonly R[] = [];
  return {
    subscribe,
    /** The one showing now, if any. */
    now: (): R | undefined => queue[0],
    /** Every one waiting, the same list until it changes. */
    all: (): readonly R[] => queue,
    add(make: (id: number) => R): void {
      queue = [...queue, make(nextId++)];
      publish();
    },
    /** Answered: the next one shows. */
    remove(id: number): void {
      queue = queue.filter((r) => r.id !== id);
      publish();
    },
  };
}
