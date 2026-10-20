/**
 * Works around what an older engine does differently
 * (docs/dev/webview-support.md). Each is measured rather than read off a
 * version, so an engine that never did it is left alone. Run once at
 * startup, before the first render.
 *
 * - `data-early-containers` on <html>: the first container-query engines
 *   (WebView2 on Chromium 107; later versions don't) made an element with
 *   `container-type` the containing block of its `position: fixed`
 *   descendants, and restarted the CSS animations inside a size container
 *   every few frames. The document column is a container
 *   (app/editor-column.css), so the editor's context menu, find bar and
 *   dialogs were placed against the column instead of the window; the AI
 *   panel's empty state is one (agent-panel.css), and its text and icon
 *   pulsed. With the attribute neither is a container. Measured by the
 *   first, which comes with the second.
 */
export function markEngineQuirks(root: HTMLElement = document.documentElement) {
  if (containerHoldsFixed(root)) root.dataset.earlyContainers = "";
}

function containerHoldsFixed(root: HTMLElement): boolean {
  const container = probe(
    root,
    "container-type: inline-size; position: absolute; top: 0; left: 40px; width: 10px",
  );
  const fixed = probe(container, "position: fixed; top: 0; left: 0");
  const held = fixed.getBoundingClientRect().left !== 0;
  container.remove();
  return held;
}

/** A hidden element in `parent`, for measuring. */
function probe(parent: HTMLElement, css: string): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `visibility: hidden; ${css}`;
  parent.append(el);
  return el;
}
