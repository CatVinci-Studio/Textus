import type { DocTab } from "./doc-tabs";
import {
  activateTab,
  paneOf,
  setTabOrder,
  splitLayout,
  windowLayout,
} from "../engine/layout/store";
import { keptFile, savedPaths, type TabOrder } from "./tab-order";
import { inOrder } from "../utils/in-order";

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
  // An order of tabs that leaves it out had it closed.
  const keyed = order.keys.some((k) => !k.startsWith("id:"));
  if (o.last && !keyed && !paths.includes(o.last)) paths.push(o.last);
  // A desktop's documents come back with its window's session, as its
  // startup setting says: not the last window's front one regardless.
  const activePath = !o.phone
    ? null
    : order.active.startsWith("path:")
      ? order.active.slice(5)
      : !order.active && o.last && !keyed
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
    const file = tab.view && keptFile(tab);
    if (file) return `path:${file}`;
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
    setTabOrder(
      pane,
      ordered.map((tab) => tab.id),
    );
  // A page in front (the AI's) back in front.
  const page = order.active.startsWith("view:")
    ? ordered.find((tab) => keyOf(tab) === order.active)
    : undefined;
  if (page) activateTab(page.id);
  return true;
}
