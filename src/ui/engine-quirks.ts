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
 * - `--sidebar-width` is registered as not inherited (sidebar-frame.css
 *   says why), and the sidebar and main pane take it from .app-shell with
 *   `inherit`. Chromium 107 doesn't restyle an element that takes a
 *   registered property with `inherit` when its parent's value changes:
 *   the sidebar kept its first width however far its edge was dragged.
 *   There it stays unregistered and inherits as any custom property does.
 */
export function markEngineQuirks(root: HTMLElement = document.documentElement) {
  if (containerHoldsFixed(root)) root.dataset.earlyContainers = "";
  if (followsInheritedRegisteredProperty(root)) {
    CSS.registerProperty({
      name: "--sidebar-width",
      syntax: "<length>",
      inherits: false,
      initialValue: "240px",
    });
  }
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

const PROBE_PROPERTY = "--textus-inherit-probe";

function followsInheritedRegisteredProperty(root: HTMLElement): boolean {
  if (typeof CSS === "undefined" || !CSS.registerProperty) return false;
  try {
    CSS.registerProperty({
      name: PROBE_PROPERTY,
      syntax: "<length>",
      inherits: false,
      initialValue: "0px",
    });
  } catch {
    return false;
  }
  const parent = probe(root, `position: absolute; ${PROBE_PROPERTY}: 10px`);
  const child = probe(
    parent,
    `${PROBE_PROPERTY}: inherit; width: var(${PROBE_PROPERTY})`,
  );
  child.getBoundingClientRect();
  parent.style.setProperty(PROBE_PROPERTY, "20px");
  const follows = child.getBoundingClientRect().width === 20;
  parent.remove();
  return follows;
}

/** A hidden element in `parent`, for measuring. */
function probe(parent: HTMLElement, css: string): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `visibility: hidden; ${css}`;
  parent.append(el);
  return el;
}
