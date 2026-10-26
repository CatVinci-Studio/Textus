/** Works around older engines, measured rather than read off a version.
 *  `data-early-containers`: early container-query engines made a container the
 *  containing block of fixed descendants and restarted animations inside it. */
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
