/** Keys only the engine's own action was kept from: Textus's shortcuts
 *  still take them (a user's own Ctrl+R binding). */
const guarded = new WeakSet<Event>();

export function keptFromEngineOnly(event: Event): boolean {
  return guarded.has(event);
}

/** F5 / Ctrl+R reload the window, discarding unsaved edits; Ctrl+P prints
 *  it (WebView2). */
function isEngineKey(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  const ctrl = (event.ctrlKey || event.metaKey) && !event.altKey;
  return key === "f5" || (ctrl && (key === "r" || key === "p"));
}

/**
 * Turns off the engine's own right-click menu (text fields take Textus's own,
 * text-field-menu.tsx) and its reload and print keys. Release builds only.
 * Caught first, so a field that keeps its keys to itself (Find, a new
 * name in the tree) can't let one through.
 */
export function installWebviewGuards(): void {
  if (import.meta.env.DEV) return;

  window.addEventListener("contextmenu", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable='true']")) return;
    event.preventDefault();
  });

  window.addEventListener(
    "keydown",
    (event) => {
      if (!isEngineKey(event) || event.defaultPrevented) return;
      event.preventDefault();
      guarded.add(event);
    },
    true,
  );
}
