import "./island-lift.css";
import "./split-drop.css";

/** An island lifted to be moved whole: what follows the pointer, and its
 *  place (wherever the preview puts it) left as a dashed outline. */
export interface IslandLift {
  move(x: number, y: number): void;
  remove(): void;
}

/**
 * Lifts island `id` - its row of tabs, its sheet, the documents on it - as
 * one piece that follows the pointer from (x, y), the islands making room
 * beneath (the preview layout); where it will land, and where it was until
 * then, only a dashed outline shows.
 */
export function liftIsland(id: string, x: number, y: number): IslandLift {
  const pane = `[data-pane-id="${CSS.escape(id)}"]`;
  const parts = [
    ...document.querySelectorAll<HTMLElement>(
      `section.island${pane}, .island-row${pane}, .split-pane${pane}`,
    ),
  ].filter((el) => el.getClientRects().length > 0);
  const rects = parts.map((el) => el.getBoundingClientRect());
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  const layer = document.createElement("div");
  layer.className = "island-lift";
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${right - left}px`,
    height: `${bottom - top}px`,
  });
  parts.forEach((el, i) => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.removeAttribute("id");
    // Unmarked and at rest, so no rule a drag sets on the island (its
    // place's outline, a tab dimmed or lifted) takes the copy too.
    for (const node of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) {
      for (const name of ["data-pane-id", "data-tab-id", "data-tab"])
        node.removeAttribute(name);
      node.classList.remove("tab-pill-lifted", "is-drag-lifted");
      node.style.removeProperty("translate");
      node.style.removeProperty("transform");
      node.style.removeProperty("opacity");
    }
    const r = rects[i];
    Object.assign(copy.style, {
      position: "absolute",
      left: `${r.left - left}px`,
      top: `${r.top - top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      margin: "0",
      gridArea: "auto",
      transform: "none",
      translate: "none",
    });
    layer.append(copy);
  });
  // Inside the window's shell: the islands' lengths and colours (their
  // radius, their paper) are set there, and a copy outside it lost its
  // rounded corners.
  (parts[0]?.closest(".app-shell, .chat-window") ?? document.body).append(
    layer,
  );
  // Its own place, as the layout has it: an outline, nothing in it.
  const style = document.createElement("style");
  style.textContent = `
    .island-row${pane}, .split-pane${pane}, section.island${pane} > * {
      visibility: hidden;
    }
    section.island${pane} {
      background: var(--drop-room-island) center / 100% 100% no-repeat !important;
      box-shadow: none !important;
    }`;
  document.head.append(style);
  return {
    move(px, py) {
      layer.style.translate = `${px - x}px ${py - y}px`;
    },
    remove() {
      layer.remove();
      style.remove();
    },
  };
}
