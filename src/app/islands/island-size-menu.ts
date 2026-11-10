import type { ContextMenuGroup } from "../../engine/controls/ContextMenu";
import {
  fillIsland,
  islandFilled,
  sizeIsland,
} from "../../engine/layout/store";
import type { Strings } from "../../i18n/strings";

/** An island's Size: a third, a half or two thirds of its row or column,
 *  or as large as its neighbours let it be (again: back as it was). */
export function islandSizeMenu(t: Strings, id: string): ContextMenuGroup {
  const share = (label: string, value: number) => ({
    label,
    onSelect: () => sizeIsland(id, value),
  });
  return {
    label: t.islandSize,
    items: [
      share("1/3", 1 / 3),
      share("1/2", 1 / 2),
      share("2/3", 2 / 3),
      "separator",
      {
        label: islandFilled(id) ? t.islandRestore : t.islandFill,
        onSelect: () => fillIsland(id),
      },
    ],
  };
}
