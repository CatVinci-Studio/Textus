import { useEffect, useState } from "react";
import {
  lateContextItems,
  type LateMenuPlace,
  type LateMenuTarget,
} from "./context-menu-items";
import type { ContextMenuItem } from "../engine/controls/ContextMenu";

/** The items plugins add to a menu as it opens, once they answer: [] until
 *  then, and again for each new `target` (null: the menu is closed). */
export function useLateContextItems(
  place: LateMenuPlace,
  target: LateMenuTarget | null,
): ContextMenuItem[] {
  const [items, setItems] = useState<ContextMenuItem[]>([]);
  const key = target && JSON.stringify(target);
  useEffect(() => {
    setItems([]);
    if (!key) return;
    let current = true;
    void lateContextItems(place, JSON.parse(key) as LateMenuTarget)?.then(
      (found) => {
        if (current) setItems(found);
      },
    );
    return () => {
      current = false;
    };
  }, [place, key]);
  return items;
}
