import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from "react";

const ITEM = '[role="treeitem"]';

/** The rows on screen, top to bottom: a folded folder's are not mounted, a
 *  hidden tree (the file tree behind search results) has none. */
function visibleItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(ITEM)).filter(
    (el) => el.getClientRects().length > 0,
  );
}

function level(el: HTMLElement): number {
  return Number(el.getAttribute("aria-level")) || 1;
}

/** Keyboard handling for a tree, per the WAI-ARIA tree pattern: one row is in
 *  the tab order, arrows move and fold, Enter and Space click. A row folds
 *  through its `data-tree-toggle` element, else its own click. */
export function useTreeKeys(ref: RefObject<HTMLElement | null>) {
  const current = useRef<HTMLElement | null>(null);

  // Keeps exactly one row tabbable as rows come and go.
  const rove = useCallback(() => {
    const root = ref.current;
    if (!root) return;
    const items = visibleItems(root);
    const keep =
      (current.current?.isConnected &&
        items.includes(current.current) &&
        current.current) ||
      items.find(
        (el) =>
          el.getAttribute("aria-selected") === "true" ||
          el.hasAttribute("aria-current"),
      ) ||
      items[0];
    for (const el of root.querySelectorAll<HTMLElement>(ITEM)) {
      const tabIndex = el === keep ? "0" : "-1";
      if (el.getAttribute("tabindex") !== tabIndex)
        el.setAttribute("tabindex", tabIndex);
    }
  }, [ref]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    rove();
    const observer = new MutationObserver(rove);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-selected", "aria-current", "hidden"],
    });
    const onFocusIn = (e: FocusEvent) => {
      const item = (e.target as HTMLElement).closest?.<HTMLElement>(ITEM);
      if (!item || !root.contains(item)) return;
      current.current = item;
      rove();
    };
    root.addEventListener("focusin", onFocusIn);
    return () => {
      observer.disconnect();
      root.removeEventListener("focusin", onFocusIn);
    };
  }, [ref, rove]);

  return useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const root = ref.current;
      const item = (e.target as HTMLElement).closest<HTMLElement>(ITEM);
      if (!root || !item || e.target !== item) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const items = visibleItems(root);
      const at = items.indexOf(item);
      const expanded = item.getAttribute("aria-expanded");
      const toggle = () =>
        (item.querySelector<HTMLElement>("[data-tree-toggle]") ?? item).click();
      let next: HTMLElement | undefined;
      switch (e.key) {
        case "ArrowDown":
          next = items[at + 1];
          break;
        case "ArrowUp":
          next = items[at - 1];
          break;
        case "Home":
          next = items[0];
          break;
        case "End":
          next = items[items.length - 1];
          break;
        case "ArrowRight":
          if (expanded === "false") toggle();
          else if (
            expanded === "true" &&
            items[at + 1] &&
            level(items[at + 1]) > level(item)
          )
            next = items[at + 1];
          break;
        case "ArrowLeft":
          if (expanded === "true") toggle();
          else
            next = items
              .slice(0, at)
              .reverse()
              .find((el) => level(el) < level(item));
          break;
        case "Enter":
        case " ":
          item.click();
          break;
        default:
          return;
      }
      e.preventDefault();
      next?.focus();
    },
    [ref],
  );
}
