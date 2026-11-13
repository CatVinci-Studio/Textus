/**
 * Giving memory back once the window has been left alone: what was kept to
 * be quick (caches, drawn views no one looks at) registers a release here,
 * and every one runs when the window has been hidden or out of focus for a
 * while - never while the user is working in it. Each must be safe to run
 * any number of times: the next use builds what it needs again.
 */
const releases = new Set<() => void>();

/** How long the window stays hidden or unfocused before memory is given back. */
export const IDLE_MS = 10 * 60_000;

export function onMemoryIdle(release: () => void): () => void {
  releases.add(release);
  return () => releases.delete(release);
}

/** Runs every release now (the window went idle, or the system is short of
 *  memory). */
export function releaseIdleMemory(): void {
  for (const release of releases) {
    try {
      release();
    } catch (error) {
      console.error("[memory-idle]", error);
    }
  }
}

let watching = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Starts watching the window, once. */
export function watchMemoryIdle(win: Window = window): void {
  if (watching) return;
  watching = true;
  const away = () => !win.document.hasFocus() || win.document.hidden;
  const check = () => {
    if (timer) clearTimeout(timer);
    timer = away() ? setTimeout(releaseIdleMemory, IDLE_MS) : null;
  };
  win.addEventListener("blur", check);
  win.addEventListener("focus", check);
  win.document.addEventListener("visibilitychange", check);
  check();
}
