import type { DocTab } from "./doc-tabs";
import {
  paneOf,
  reorderInPane,
  splitLayout,
  windowLayout,
} from "../engine/layout/store";
import { inOrder, savedPaths, type TabOrder } from "./tab-order";

/** The file a tab shows: its own, a plugin view's, or the one imported. */
export const fileOf = (tab: DocTab) =>
  tab.path ?? tab.view?.resource ?? tab.importedFrom;

/**
 * Brings back the tabs a launch with no window session finds: the drafts
 * recovered (`restored`) and, on a phone, the saved documents the order
 * kept (else the last one opened), the one in front into the initial tab,
 * all in the order they had. False when there was nothing to bring.
 */
export async function restoreTabsInOrder(o: {
  order: TabOrder;
  restored: DocTab[];
  /** A restored tab's id before, by its id now. */
  oldIds: Map<string, string>;
  frontDraft?: DocTab;
  last: string | null;
  phone: boolean;
  initial: string;
  loadRecovered: (tab: DocTab) => void;
  /** Opens a saved document in the initial tab; false when it is gone. */
  loadFile: (path: string) => Promise<boolean>;
  tabsForPaths: (paths: string[], quiet: boolean) => Promise<DocTab[]>;
  setTabs: (update: (prev: DocTab[]) => DocTab[]) => void;
}): Promise<boolean> {
  const { order, restored, oldIds } = o;
  const recoveredFor = (path: string) => restored.find((t) => t.path === path);
  const paths = o.phone ? savedPaths(order) : [];
  // Kept by a build that knew only drafts: the last document, in front.
  if (o.last && !paths.includes(o.last)) paths.push(o.last);
  const activePath = order.active.startsWith("path:")
    ? order.active.slice(5)
    : !order.active && o.last
      ? o.last
      : null;
  const front =
    o.frontDraft ??
    (activePath ? recoveredFor(activePath) : undefined) ??
    (activePath ? undefined : restored[0]);
  let shown: string | null = null;
  if (front) {
    o.loadRecovered(front);
    oldIds.set(o.initial, oldIds.get(front.id) ?? "");
  } else if (activePath && (await o.loadFile(activePath))) shown = activePath;
  else if (restored[0]) {
    o.loadRecovered(restored[0]);
    oldIds.set(o.initial, oldIds.get(restored[0].id) ?? "");
  }
  const behind = await o.tabsForPaths(
    paths.filter((p) => p !== shown && !recoveredFor(p)),
    true,
  );
  if (!front && !shown && !restored.length && !behind.length) return false;
  const keyOf = (tab: DocTab) => {
    if (tab.view) return `view:${tab.view.view ?? tab.view.kind}`;
    const old = oldIds.get(tab.id);
    if (old) return `id:${old}`;
    return tab.path ? `path:${tab.path}` : `id:${tab.id}`;
  };
  let ordered: DocTab[] = [];
  o.setTabs((prev) => {
    const open = new Set(prev.map(fileOf).filter(Boolean));
    ordered = inOrder(
      [...prev, ...behind.filter((tab) => !open.has(fileOf(tab)))],
      keyOf,
      order.keys,
    );
    return ordered;
  });
  // The island takes that order too.
  const pane = paneOf(windowLayout(), o.initial);
  if (pane && !splitLayout())
    ordered.forEach((tab, i) => reorderInPane(pane, tab.id, i));
  return true;
}
