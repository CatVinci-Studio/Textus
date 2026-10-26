/** Storage writes Rust hasn't answered yet. A Tauri window closes without
 *  `pagehide`, so every close the frontend handles awaits
 *  `flushPendingWrites()` before the window is destroyed. */

const inFlight = new Set<Promise<unknown>>();
const flushers = new Set<() => void>();

/** How long a closing window waits at most: a wedged IPC must never keep a
 *  window from closing. */
const FLUSH_TIMEOUT_MS = 2000;

/** Remembers a storage write until it settles. Returns the same promise. */
export function trackWrite<T>(write: Promise<T>): Promise<T> {
  inFlight.add(write);
  const done = () => {
    inFlight.delete(write);
  };
  write.then(done, done);
  return write;
}

/** Registers something to send right away when the window is about to go:
 *  a debounced write still waiting for its timer. Returns the unregister. */
export function onFlush(flush: () => void): () => void {
  flushers.add(flush);
  return () => flushers.delete(flush);
}

/** Sends every held-back write now and resolves once Rust has answered all
 *  writes this page started, or after `timeoutMs`. Never rejects. The
 *  held-back writes go out before the first await, for callers that can't wait. */
export async function flushPendingWrites(
  timeoutMs = FLUSH_TIMEOUT_MS,
): Promise<void> {
  for (const flush of flushers) {
    try {
      flush();
    } catch {
      // One store failing to send must not keep the others from it.
    }
  }
  const deadline = Date.now() + timeoutMs;
  // A write that settles can start another (a confirmation that finds the
  // field changed again), so wait until nothing is left in flight.
  while (inFlight.size > 0) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      Promise.allSettled([...inFlight]).then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), remaining);
      }),
    ]);
    clearTimeout(timer);
    if (timedOut) return;
  }
}

let flushOnHideInstalled = false;

/** Also sends the held-back writes whenever the page is hidden or unloads:
 *  iOS backgrounds an app with only a visibility change, and a reload fires
 *  `pagehide` rather than a close request. Idempotent. */
export function flushWhenHidden(): void {
  if (flushOnHideInstalled) return;
  flushOnHideInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushPendingWrites();
  });
  window.addEventListener("pagehide", () => void flushPendingWrites());
}

export function resetPendingWritesForTests(): void {
  inFlight.clear();
  flushers.clear();
}
