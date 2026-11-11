import { clearSlides, passedCount, slideAside } from "../../engine/drag/row";
import { trackDrag } from "../../engine/drag/pointer-drag";

/** The line between Textus's own (and pinned) icons and the plugins'. */
export const RAIL_DIVIDER = "rail-divider";

/**
 * An icon dragged along the whole rail, both groups and the line between
 * them one column: the icons and the line slide aside as it passes, its
 * place stays open for it, and a lifted copy follows the pointer - the
 * scrolling group would clip the icon itself. `onDrop` hears the order
 * the column now has (the line among the ids). `staysAbove`: the icon may
 * not go under the line (Textus's own).
 */
export function railDrag(
  down: PointerEvent,
  {
    rail,
    id,
    staysAbove,
    onDrop,
  }: {
    rail: HTMLElement;
    id: string;
    staysAbove: boolean;
    onDrop: (order: string[]) => void;
  },
): void {
  const nodes = () =>
    [...rail.querySelectorAll<HTMLElement>("[data-rail-id]")].map((node) => ({
      id: node.dataset.railId ?? "",
      node,
    }));
  let state: {
    items: { id: string; node: HTMLElement }[];
    others: { id: string; node: HTMLElement }[];
    centers: number[];
    mine: number;
    from: number;
    room: number;
    shown: number[];
    copy: HTMLElement;
    dragged: HTMLElement;
    box: DOMRect;
  } | null = null;

  const indexAt = (y: number) => {
    if (!state) return 0;
    const to = passedCount(state.centers, state.mine + (y - down.clientY));
    // Textus's own icons stay above the line.
    const line = state.others.findIndex((o) => o.id === RAIL_DIVIDER);
    return staysAbove && line >= 0 ? Math.min(to, line) : to;
  };

  trackDrag(down, {
    start: () => {
      const items = nodes();
      const at = items.findIndex((item) => item.id === id);
      if (at < 0) return;
      const dragged = items[at].node;
      const box = dragged.getBoundingClientRect();
      const others = items.filter((item) => item.id !== id);
      const center = (node: HTMLElement) => {
        const r = node.getBoundingClientRect();
        return r.top + r.height / 2;
      };
      const gap = parseFloat(getComputedStyle(dragged.parentElement!).rowGap);
      const copy = dragged.cloneNode(true) as HTMLElement;
      copy.removeAttribute("data-rail-id");
      copy.setAttribute("aria-hidden", "true");
      copy.classList.add("tx-drag-ghost", "is-lifted");
      Object.assign(copy.style, {
        left: "0",
        top: "0",
        width: `${box.width}px`,
        height: `${box.height}px`,
        translate: `${box.left}px ${box.top}px`,
      });
      document.body.append(copy);
      dragged.style.visibility = "hidden";
      rail.classList.add("is-reordering");
      state = {
        items,
        others,
        centers: others.map((o) => center(o.node)),
        mine: box.top + box.height / 2,
        from: at,
        room: box.height + (gap || 0),
        shown: new Array<number>(others.length).fill(0),
        copy,
        dragged,
        box,
      };
    },
    move: (_x, y) => {
      if (!state) return;
      const { box, copy, others, shown, from, room } = state;
      copy.style.translate = `${box.left}px ${box.top + (y - down.clientY)}px`;
      slideAside(others, shown, from, indexAt(y), room, "y");
    },
    end: (_x, y, dropped) => {
      if (!state) return;
      const { items, others, copy, dragged, from } = state;
      const to = indexAt(y);
      copy.remove();
      dragged.style.visibility = "";
      rail.classList.remove("is-reordering");
      clearSlides(items);
      state = null;
      if (!dropped || to === from) return;
      const order = others.map((o) => o.id);
      order.splice(to, 0, id);
      onDrop(order);
    },
  });
}
