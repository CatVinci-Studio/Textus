/**
 * Turns off the engine's own right-click menu (text fields keep it) and the
 * F5 / Ctrl+R reload, which would discard unsaved edits. Release builds only.
 * Bubble phase, so a user's own Ctrl+R binding still runs.
 */
export function installWebviewGuards(): void {
  if (import.meta.env.DEV) return;

  window.addEventListener("contextmenu", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable='true']")) return;
    event.preventDefault();
  });

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const reload =
      key === "f5" ||
      (key === "r" && (event.ctrlKey || event.metaKey) && !event.altKey);
    if (reload) event.preventDefault();
  });
}
