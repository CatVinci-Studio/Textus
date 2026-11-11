/**
 * The one watch on the window's look: the root's attributes (theme, scale,
 * platform, layout marks) and the stylesheets in <head> - a theme applied,
 * Interface Text Size, a stylesheet loaded - and the system's light or dark.
 * Everything that reads computed tokens hears it from here, once per
 * change, instead of watching the page itself.
 */
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

function start(): () => void {
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  const root = new MutationObserver(changed);
  root.observe(document.documentElement, { attributes: true });
  const head = new MutationObserver(changed);
  head.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)");
  const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  dark?.addEventListener?.("change", changed);
  motion?.addEventListener?.("change", changed);
  return () => {
    root.disconnect();
    head.disconnect();
    dark?.removeEventListener?.("change", changed);
    motion?.removeEventListener?.("change", changed);
  };
}

/** Calls `listener` whenever the window's look may have changed; returns
 *  the function that stops. The watch runs while anyone listens. */
export function onAppearance(listener: () => void): () => void {
  if (typeof MutationObserver !== "function") return () => {};
  listeners.add(listener);
  stop ??= start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop?.();
      stop = null;
    }
  };
}
