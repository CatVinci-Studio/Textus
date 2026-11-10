import { useSyncExternalStore } from "react";
import {
  fillIsland,
  splitLayout,
  subscribeSplit,
  zoomedIsland,
} from "../../engine/layout/store";
import { panesOf } from "../../engine/layout/tree";
import type { Strings } from "../../i18n/strings";
import "./fill-note.css";

/** On a filled island's row, while it is filled: how many islands are put
 *  away, and the way back to them. */
export function FillNote({ paneId, t }: { paneId?: string; t: Strings }) {
  const zoom = useSyncExternalStore(subscribeSplit, zoomedIsland);
  const layout = useSyncExternalStore(subscribeSplit, splitLayout);
  if (!paneId || zoom !== paneId || !layout) return null;
  const away = panesOf(layout.root).length - 1;
  return (
    <button
      type="button"
      className="tx-chip island-fill-note"
      onClick={() => fillIsland(paneId)}
    >
      {t.islandAway.replace("{n}", String(away))}
      <span aria-hidden="true">·</span>
      {t.islandRestore}
    </button>
  );
}
