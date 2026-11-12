import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";

const ITEM = '[role="treeitem"]';

/** The rows on screen, top to bottom: a folded folder's are not mounted, a
 *  hidden tree (the file tree behind search results) has none. */
function visibleItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(ITEM)).filter(
    (el) => el.getClientRects().length > 0,
  );
}

/** The first row on screen that `wanted`, reading layout only up to it. */
function firstShown(
  root: HTMLElement,
  wanted: (el: HTMLElement) => boolean,
): HTMLElement | undefined {
  for (const el of root.querySelectorAll<HTMLElement>(ITEM))
    if (wanted(el) && el.getClientRects().length > 0) return el;
  return undefined;
}

function setTabIndex(el: HTMLElement, value: "0" | "-1") {
  if (el.getAttribute("tabindex") !== value) el.setAttribute("tabindex", value);
}

function level(el: HTMLElement): number {
  return Number(el.getAttribute("aria-level")) || 1;
}

/** The tree's element (its `ref`) and keyboard handling for it, per the WAI-ARIA tree pattern: one row is in
 *  the tab order, arrows move and fold, Enter and Space click. A row folds
 *  through its `data-tree-toggle` element, else its own click. */
export function useTreeKeys<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const current = useRef<HTMLElement | null>(null);
  const tabbable = useRef<HTMLElement | null>(null);

  // Keeps exactly one row tabbable as rows come and go, for the cost of
  // the rows that came: a big tree changes often.
  const rove = useCallback(
    (records?: MutationRecord[]) => {
      const root = ref.current;
      if (!root) return;
      const rows = records
        ? records.flatMap((r) =>
            [...r.addedNodes].flatMap((n) =>
              n instanceof HTMLElement
                ? [
                    ...(n.matches(ITEM) ? [n] : []),
                    ...n.querySelectorAll<HTMLElement>(ITEM),
                  ]
                : [],
            ),
          )
        : root.querySelectorAll<HTMLElement>(ITEM);
      for (const el of rows) setTabIndex(el, "-1");
      const was = current.current;
      const keep =
        (was?.isConnected && root.contains(was) && was) ||
        firstShown(
          root,
          (el) =>
            el.getAttribute("aria-selected") === "true" ||
            el.hasAttribute("aria-current"),
        ) ||
        firstShown(root, () => true);
      const old = tabbable.current;
      if (old && old !== keep) setTabIndex(old, "-1");
      if (keep) setTabIndex(keep, "0");
      tabbable.current = keep || null;
    },
    [ref],
  );

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    rove();
    const observer = new MutationObserver((records) => rove(records));
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
      rove([]);
    };
    root.addEventListener("focusin", onFocusIn);
    return () => {
      observer.disconnect();
      root.removeEventListener("focusin", onFocusIn);
    };
  }, [ref, rove]);

  const onKeyDown = useCallback(
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
  return { ref, onKeyDown };
}
