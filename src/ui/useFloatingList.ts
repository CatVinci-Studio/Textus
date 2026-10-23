import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

const MENU_MAX_HEIGHT = 280;

/**
 * A list that opens beside the control that opened it (Select.tsx): placed
 * below it, or above when the window has no room under it, and kept inside
 * the window across; focused while open, dismissed by a press outside or by
 * the page moving under it; the highlighted option (`active`, its
 * `data-index`) kept in view.
 */
export function useFloatingList(
  open: boolean,
  active: number,
  dismiss: () => void,
) {
  const [place, setPlace] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Where the trigger was when the list was placed beside it.
  const placedAt = useRef<DOMRect | null>(null);

  // Below the trigger, or above when the window has no room under it.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    placedAt.current = rect;
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const up = below < Math.min(MENU_MAX_HEIGHT, 160) && above > below;
    setPlace({
      left: Math.min(rect.left, window.innerWidth - rect.width - 8),
      minWidth: rect.width,
      maxHeight: Math.min(MENU_MAX_HEIGHT, up ? above : below),
      ...(up
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
      // It grows out of the edge that touches the trigger.
      ...({
        "--transform-origin": up ? "bottom left" : "top left",
      } as CSSProperties),
    });
  }, [open]);

  // Then kept inside the window across: the list is often wider than its
  // trigger (Settings' image models, "OpenAI · gpt-image-…" beside a "None"
  // button), and placed by the trigger's width alone it ran past the
  // window's right edge. One that doesn't fit lines up with the trigger's
  // right edge instead, and never leaves the window. Layout width, not the
  // box: the entrance scales it from 96%.
  useLayoutEffect(() => {
    const list = listRef.current;
    const rect = placedAt.current;
    const placed = place.left;
    if (!open || !list || !rect || typeof placed !== "number") return;
    const width = list.offsetWidth;
    const room = window.innerWidth - 8;
    if (placed + width <= room) return;
    const left = Math.max(8, Math.min(rect.right, room) - width);
    setPlace(
      (p) =>
        ({
          ...p,
          left,
          maxWidth: room - 8,
          "--transform-origin": `${p.bottom !== undefined ? "bottom" : "top"} right`,
        }) as CSSProperties,
    );
  }, [open, place.left]);

  // While open: focus the list, close on any outside press, and close when
  // the page moves under it (the list is placed once, from the trigger).
  useEffect(() => {
    if (!open) return;
    // Without preventScroll the browser may scroll the page's own scroll
    // areas to bring the list into view before it is placed (a Settings
    // page still settling in moved, and the scroll closed the list).
    listRef.current?.focus({ preventScroll: true });
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        listRef.current?.contains(target)
      )
        return;
      dismiss();
    };
    const onMove = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return;
      dismiss();
    };
    // A scroll event arrives a frame after the scroll itself, so one made
    // just before the list opened (the trigger scrolled into view, a wheel
    // still settling) lands after the list was placed where the trigger
    // already is. Only a scroll that moved the trigger leaves it behind.
    const onScroll = (e: Event) => {
      const now = triggerRef.current?.getBoundingClientRect();
      const then = placedAt.current;
      if (now && then && now.top === then.top && now.left === then.left) return;
      onMove(e);
    };
    document.addEventListener("mousedown", onPointer, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("blur", onMove);
    return () => {
      document.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("blur", onMove);
    };
    // Bound once per opening, as when this lived in Select.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The highlighted option stays in view by scrolling the list alone:
  // scrollIntoView would scroll every area around it too.
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    const item = list.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (
      item.offsetTop + item.offsetHeight >
      list.scrollTop + list.clientHeight
    )
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
  }, [open, active]);

  return { triggerRef, listRef, place };
}
