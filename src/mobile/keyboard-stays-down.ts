const EDITORS = ".ProseMirror, .cm-content";

/**
 * On a phone a document brought to the front is read first: its editor
 * taking focus on its own just after (a file opened from the sidebar) is let
 * go, so the keyboard stays down until a tap in the page. Returns the stop.
 */
export function keyboardStaysDown(ms = 800): () => void {
  let tapped = false;
  const editing = (el: EventTarget | null) =>
    el instanceof HTMLElement && !!el.closest(EDITORS);
  const down = (e: PointerEvent) => {
    if (editing(e.target)) tapped = true;
  };
  const focused = (e: FocusEvent) => {
    if (!tapped && editing(e.target)) (e.target as HTMLElement).blur();
  };
  window.addEventListener("pointerdown", down, true);
  window.addEventListener("focusin", focused, true);
  const timer = setTimeout(stop, ms);
  function stop() {
    clearTimeout(timer);
    window.removeEventListener("pointerdown", down, true);
    window.removeEventListener("focusin", focused, true);
  }
  return stop;
}
