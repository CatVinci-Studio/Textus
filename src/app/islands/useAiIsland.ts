import { useEffect, useState } from "react";
import { useLatest } from "../../utils/hooks/useLatest";
import { showAiIsland } from "../../engine/layout/store";

/**
 * The AI island in the documents' grid: in the layout while its panel is
 * shown (and while it plays its way out), its share of the width the
 * panel's remembered width, read when it opens, not as tabs come and go.
 * Tells its drawn width back, for the title to keep clear of.
 */
export function useAiIsland(
  shown: boolean,
  tabIds: readonly string[],
  activeTabId: string,
  width: number,
) {
  const [drawnWidth, setDrawnWidth] = useState(0);
  const opening = useLatest({ tabIds, activeTabId, width });
  useEffect(() => {
    const { tabIds, activeTabId, width } = opening.current;
    const area = document.querySelector(".main-pane")?.clientWidth;
    const share = area ? width / area : 0.3;
    showAiIsland(
      shown,
      tabIds,
      activeTabId,
      Math.min(0.5, Math.max(0.2, share)),
    );
  }, [shown, opening]);
  return { drawnWidth, setDrawnWidth };
}
