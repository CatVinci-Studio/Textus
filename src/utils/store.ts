/** Who listens to a module's own state, told when it changes: what
 *  useSyncExternalStore subscribes to. `whileHeard` starts what feeds the
 *  state with the first listener; what it returns stops it after the last. */
export function createSubscribers<A extends unknown[] = []>(
  whileHeard?: () => () => void,
): {
  subscribe: (listener: (...args: A) => void) => () => void;
  publish: (...args: A) => void;
} {
  const listeners = new Set<(...args: A) => void>();
  let stop: (() => void) | null = null;
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      if (whileHeard && !stop) stop = whileHeard();
      return () => {
        listeners.delete(listener);
        if (listeners.size || !stop) return;
        const was = stop;
        stop = null;
        was();
      };
    },
    publish: (...args) => {
      for (const listener of [...listeners]) listener(...args);
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
