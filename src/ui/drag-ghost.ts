/**
 * The copy that follows the pointer while something is moved somewhere
 * else (a tab pulled out to split the window, a file dragged in the tree):
 * one look and one place for every such drag, centred under the pointer as
 * the pill between windows is (tab_drag/pill.rs). Reordering within a row
 * moves the thing itself instead (pointer-drag.ts).
 */
export interface DragGhost {
  move(x: number, y: number): void;
  remove(): void;
}

export function dragGhost(text: string, className: string): DragGhost {
  const ghost = document.createElement("div");
  ghost.className = `drag-ghost ${className}`;
  ghost.textContent = text;
  ghost.setAttribute("aria-hidden", "true");
  document.body.append(ghost);
  return {
    // By `translate`, not `transform`: the lifted look's `scale` would
    // scale a transform's offset too, and the copy drift off the pointer.
    move(x, y) {
      ghost.style.translate = `${x - ghost.offsetWidth / 2}px ${y - ghost.offsetHeight / 2}px`;
    },
    remove() {
      ghost.remove();
    },
  };
}
