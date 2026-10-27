import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useLatest } from "../utils/hooks/useLatest";

const MENU_MAX_HEIGHT = 280;

/** A list that opens beside its control: below it, or above without room,
 *  kept inside the window; focused while open, dismissed by an outside press
 *  or the page moving, with the highlighted option kept in view. */
export function useFloatingList(
  open: boolean,
  active: number,
  dismiss: () => void,
  /** How tall the list may grow; a longer one scrolls. */
  maxHeight = MENU_MAX_HEIGHT,
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
    const up = below < Math.min(maxHeight, 160) && above > below;
    setPlace({
      left: Math.min(rect.left, window.innerWidth - rect.width - 8),
      minWidth: rect.width,
      maxHeight: Math.min(maxHeight, up ? above : below),
      ...(up
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
      // It grows out of the edge that touches the trigger.
      ...({
        "--transform-origin": up ? "bottom left" : "top left",
      } as CSSProperties),
    });
  }, [open, maxHeight]);

  // Then kept inside the window across: the list is often wider than its
  // trigger. Layout width, not the box: the entrance scales it from 96%.
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

  // While open: focus the list, and close on an outside press or when the page
  // moves under it. The latest dismiss is read when it fires.
  const close = useLatest(dismiss);
  useEffect(() => {
    if (!open) return;
    const dismiss = () => close.current();
    // Without preventScroll the browser may scroll the page to bring the list
    // into view before it is placed, and that scroll would close it.
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
    // A scroll event arrives a frame late, so one made just before the list
    // opened lands after it was placed. Only a scroll that moved the trigger counts.
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
  }, [open, close]);

  // The highlighted option stays in view by scrolling the list alone:
  // scrollIntoView would scroll every area around it too.
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    const item = list.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!item) return;
    // A row pinned at the top (a search box) covers what scrolls under it.
    const pinned =
      list.querySelector<HTMLElement>(":scope > [data-pinned]")?.offsetHeight ??
      0;
    if (item.offsetTop - pinned < list.scrollTop)
      list.scrollTop = item.offsetTop - pinned;
    else if (
      item.offsetTop + item.offsetHeight >
      list.scrollTop + list.clientHeight
    )
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
  }, [open, active]);

  return { triggerRef, listRef, place };
}
