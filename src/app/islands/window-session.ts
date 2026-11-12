import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DocTab } from "../../document/doc-tabs";
import { session } from "../../platform/ipc";
import { takeWindowSession } from "../../document/launch-window";
import { canUseWindows } from "../../platform/capabilities";
import { trackWrite } from "../../storage/pending-writes";
import { getUiState, setUiState } from "../../storage/ui-state";
import { afterStartupRestore } from "../../document/reload-tabs";
import {
  setSplitLayout,
  splitLayout,
  subscribeSplit,
} from "../../engine/layout/store";
import { asRoot } from "../../engine/layout/ops";
import { panesOf } from "../../engine/layout/tree";
import {
  buildSaved,
  readSavedSplit,
  saveNode,
  savedPaths,
} from "./saved-layout";

/** A file's tab by its path: a document's, or a plugin's tab of a file. */
const pathOf = (tab: DocTab) => tab.path ?? tab.view?.resource ?? null;

/**
 * Brings this window's islands back once the launch has opened its
 * documents, then keeps its session written as it changes - not before, so
 * a start with only some documents open can't overwrite the islands saved.
 */
export function useWindowSession(
  tabs: readonly DocTab[],
  folder: string | null,
  activate: (id: string) => void,
): void {
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const [ready, setReady] = useState(false);
  const layout = useSyncExternalStore(subscribeSplit, splitLayout);

  useEffect(() => {
    const restore = async () => {
      const taken = await takeWindowSession();
      const saved = readSavedSplit(taken?.layout ?? olderSplit());
      if (saved) {
        const idOf = new Map<string, string>();
        for (const tab of tabsRef.current) {
          const path = pathOf(tab);
          if (path && savedPaths(saved).includes(path)) idOf.set(path, tab.id);
        }
        const root = buildSaved(saved, idOf);
        if (root && root.kind === "split") {
          const [first] = panesOf(root);
          // Its first island's document in front, so the split keeps them all.
          if (first.front) activate(first.front);
          setSplitLayout({ root: asRoot(root), focus: first.id });
        }
      }
      setReady(true);
    };
    // Once the tabs the launch opened are drawn.
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = afterStartupRestore(() => {
      frame = requestAnimationFrame(
        () => (timer = setTimeout(() => void restore())),
      );
    });
    return () => {
      stop();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [activate]);

  const paths = tabs.flatMap((tab) => pathOf(tab) ?? []);
  const key = JSON.stringify([paths, layout && layout.root, folder]);
  useEffect(() => {
    if (!canUseWindows || !ready) return;
    const byId = new Map(tabsRef.current.map((tab) => [tab.id, pathOf(tab)]));
    const tree = layout && saveNode(layout.root, (id) => byId.get(id) ?? null);
    void trackWrite(
      session.updateWindow({
        paths: [...new Set(paths)],
        layout: tree && "children" in tree ? { tree } : null,
        folder,
      }),
    ).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by its key
  }, [key, ready]);
}

/** The split an earlier version kept for every window at once: taken
 *  by the first window to restore, once. */
function olderSplit(): unknown {
  const old = getUiState("splitLayout");
  if (old) setUiState("splitLayout", null);
  return old ?? null;
}
