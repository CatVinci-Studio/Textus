import { animate } from "../motion/motion";
/**
 * The copy that follows the pointer while something is moved somewhere
 * else (a tab pulled out to split the window, a file dragged in the tree):
 * one look and one place for every such drag, centred under the pointer as
 * the pill between windows is (tab_drag/pill.rs). Reordering within a row
 * moves the thing itself instead (pointer-drag.ts).
 */
export interface DragGhost {
  move(x: number, y: number): void;
  /** Out of sight while something else follows the pointer instead. */
  hide(hidden: boolean): void;
  /** Gathers in from `from` (the tab it was) to the pointer: the tuck
   *  spring. */
  gather(from: DOMRect): void;
  /** Flies to `to`'s start and fades there (the land spring), then goes. */
  land(to: DOMRect): void;
  remove(): void;
}

/** The move that puts `ghost`, where it is, at `rect`'s start: never
 *  scaled - grown to an island's size, its words blurred across it. */
function toward(ghost: HTMLElement, rect: DOMRect): Keyframe {
  const box = ghost.getBoundingClientRect();
  const dx = rect.left - box.left;
  const dy =
    rect.top +
    Math.min(rect.height, box.height) / 2 -
    (box.top + box.height / 2);
  return { transform: `translate(${dx}px, ${dy}px)` };
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
    hide(hidden) {
      ghost.style.visibility = hidden ? "hidden" : "";
    },
    gather(from) {
      animate(ghost, [toward(ghost, from), { transform: "none" }], {
        duration: "--dur-tuck",
        easing: "--ease-tuck",
      });
    },
    land(to) {
      const flight = animate(
        ghost,
        [{ transform: "none" }, { ...toward(ghost, to), opacity: 0 }],
        { duration: "--dur-land", easing: "--ease-land", fill: "forwards" },
      );
      if (flight) void flight.finished.finally(() => ghost.remove());
      else ghost.remove();
    },
    remove() {
      ghost.remove();
    },
  };
}
