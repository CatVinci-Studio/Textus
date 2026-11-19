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

/** `root` with tab `id` in front: of the island holding it, else of the
 *  first; and that island. */
export function withTabInFront(
  root: LayoutNode,
  id: string,
): { root: LayoutNode; island: string } {
  const panes = panesOf(root);
  const holder = panes.find((p) => p.tabs.includes(id)) ?? panes[0];
  return {
    root: mapPanes(root, (p) =>
      p.id === holder.id
        ? {
            ...p,
            tabs: p.tabs.includes(id) ? p.tabs : [...p.tabs, id],
            front: id,
          }
        : p,
    ),
    island: holder.id,
  };
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
          if (
            path &&
            (savedPaths(saved).includes(path) || taken?.opened?.includes(path))
          )
            idOf.set(path, tab.id);
        }
        const built = buildSaved(saved, idOf);
        const root =
          built && withDraftInFront(built, windowTabs<DocTab>(), tabInUse());
        if (root && root.kind === "split") {
          // A document opened from outside in front, in its island;
          // else the first island's, so the split keeps them all.
          const opened = taken?.opened?.[0];
          const openedId = opened ? idOf.get(opened) : undefined;
          const shown = openedId
            ? withTabInFront(root, openedId)
            : { root, island: panesOf(root)[0].id };
          const front = panesOf(shown.root).find(
            (p) => p.id === shown.island,
          )?.front;
          if (front) activate(front);
          setSplitLayout({ root: asRoot(shown.root), focus: shown.island });
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
