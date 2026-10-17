/**
 * Storage writes this page has started but Rust hasn't answered yet, and
 * the way to wait for them before the window goes away.
 *
 * localStorage was synchronous: whatever had been set was kept, however
 * soon the window closed. The files Rust owns (docs/dev/storage.md) are
 * reached through IPC, which is not. Every settings, UI-state and history
 * change is sent as it is made (SettingsContext's persist), but a window
 * destroyed before Rust has taken it can still drop it - and one value is
 * held back on purpose: useZoom saves the zoom only once a pinch or wheel
 * burst has rested. `pagehide` doesn't help: a Tauri window closes without
 * firing it.
 *
 * So every close the frontend handles - the window's close request (its
 * close button, File > Close Window, Quit / Cmd+Q, which closes each window
 * in turn, the last window's close), the unsaved-changes prompt's Save and
 * Don't Save, closing the last tab, the detached chat closing - awaits
 * `flushPendingWrites()` before it lets the window be destroyed, and so
 * does installing an update (before the download too: on Windows the
 * installer ends the process inside it). Once Rust has the change, it is
 * written to disk on its own debounce or when the app exits (settings.rs's
 * flush_all).
 *
 * Two windows are destroyed by Rust with no close request, and can't wait:
 * a single-tab window dragged onto another window's tabs (useTabDragMerge
 * sends what's held back just before, so it lands first) and a detached
 * chat whose editor window closed (it holds nothing back - its only
 * setting, the pin, is sent at once - and its writes are already on their
 * way). macOS's Dock "Quit" and a logout end the app without asking any
 * window, as they skip the unsaved-changes prompt too.
 */

const inFlight = new Set<Promise<unknown>>();
const flushers = new Set<() => void>();

/** How long a closing window waits at most: a wedged IPC must never keep a
 *  window from closing. Rust answers these in well under a millisecond. */
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

/**
 * Sends every held-back write now and resolves once Rust has answered all
 * the writes this page started - or after `timeoutMs`, whichever is first.
 * Never rejects. The held-back writes go out synchronously, before the
 * first await, so a caller that can't wait (a window Rust is about to
 * destroy) still gets them on their way first.
 */
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

/**
 * Also sends the held-back writes whenever the page is hidden or unloads,
 * where nothing can be awaited: iOS sends an app to the background (where
 * it may be ended without notice) with only a visibility change, and a
 * reload fires `pagehide` rather than a close request. Anything already in
 * flight lands on its own while the app still runs. Called once at startup
 * (main.tsx); calling it again does nothing.
 */
export function flushWhenHidden(): void {
  if (flushOnHideInstalled) return;
  flushOnHideInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushPendingWrites();
  });
  window.addEventListener("pagehide", () => void flushPendingWrites());
}

/** Forgets everything, for tests. */
export function resetPendingWritesForTests(): void {
  inFlight.clear();
  flushers.clear();
}
