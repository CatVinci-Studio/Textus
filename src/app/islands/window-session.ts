import { useEffect, useState, useSyncExternalStore } from "react";
import type { DocTab } from "../../document/doc-tabs";
import { session } from "../../platform/ipc";
import { takeWindowSession } from "../../document/launch-window";
import { canUseWindows } from "../../platform/capabilities";
import { trackWrite } from "../../storage/pending-writes";
import { afterStartupRestore } from "../../document/reload-tabs";
import {
  setSplitLayout,
  subscribeSplit,
  tabInUse,
  windowLayout,
  windowTabs,
} from "../../engine/layout/store";
import { asRoot } from "../../engine/layout/ops";
import { mapPanes, panesOf, type LayoutNode } from "../../engine/layout/tree";
import {
  buildSaved,
  readSavedSplit,
  saveNode,
  savedPaths,
} from "../../engine/layout/saved";

/** A file's tab by its path: a document's, or a plugin's tab of a file. */
const pathOf = (tab: DocTab) => tab.path ?? tab.view?.resource ?? null;

/** The saved islands with the draft the launch put in front (a split
 *  keeps only files) in front of the first island, or as they were. */
export function withDraftInFront(
  root: LayoutNode,
  tabs: readonly DocTab[],
  inUse: string,
): LayoutNode {
  const draft = tabs.find((tab) => tab.id === inUse && !pathOf(tab));
  const [first] = panesOf(root);
  if (!draft || !first) return root;
  return mapPanes(root, (p) =>
    p.id === first.id
      ? { ...p, tabs: [...p.tabs, draft.id], front: draft.id }
      : p,
  );
}

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
  const [ready, setReady] = useState(false);
  const layout = useSyncExternalStore(subscribeSplit, windowLayout);

  useEffect(() => {
    const restore = async () => {
      const taken = await takeWindowSession();
      const raw = taken?.layout ?? null;
      const saved = readSavedSplit(raw);
      // One island: the restore already opened its front document in the
      // tab in use; nothing here pulls focus from what the user picked.
      if (saved) {
        const idOf = new Map<string, string>();
        for (const tab of windowTabs<DocTab>()) {
          const path = pathOf(tab);
          if (path && savedPaths(saved).includes(path)) idOf.set(path, tab.id);
        }
        const built = buildSaved(saved, idOf);
        const root =
          built && withDraftInFront(built, windowTabs<DocTab>(), tabInUse());
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
  const key = JSON.stringify([paths, layout.root, folder]);
  useEffect(() => {
    if (!canUseWindows || !ready) return;
    const byId = new Map(
      windowTabs<DocTab>().map((tab) => [tab.id, pathOf(tab)]),
    );
    const tree = saveNode(layout.root, (id) => byId.get(id) ?? null);
    void trackWrite(
      session.updateWindow({
        paths: [...new Set(paths)],
        layout: tree ? { tree } : null,
        folder,
      }),
    ).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by its key
  }, [key, ready]);
}
