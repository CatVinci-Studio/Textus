/**
 * The list views plugins have registered (textus.views.registerList): what
 * PluginListView needs to draw one - whether the plugin answers a click or
 * a tick itself, the field over it, the line it shows - and a version each
 * refresh moves on, so a shown list asks for its items again. The items
 * themselves are asked of the plugin's code each time (manager.ts's
 * askPlugin "$listItems"), never kept here.
 */
export interface ListViewInfo {
  plugin: string;
  view: string;
  select: boolean;
  check: boolean;
  filterPlaceholder?: string;
  emptyText?: string;
  message: string;
  version: number;
}

const views = new Map<string, ListViewInfo>();
const listeners = new Set<() => void>();
let changes = 0;

function key(plugin: string, view: string) {
  return `${plugin}\u0000${view}`;
}

function changed() {
  changes++;
  for (const listener of listeners) listener();
}

export function subscribeListViews(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Moves on whenever any list view does: for useSyncExternalStore. */
export function listViewsVersion(): number {
  return changes;
}

export function listView(plugin: string, view: string): ListViewInfo | null {
  return views.get(key(plugin, view)) ?? null;
}

export function registerListView(
  plugin: string,
  view: string,
  info: Pick<
    ListViewInfo,
    "select" | "check" | "filterPlaceholder" | "emptyText"
  >,
): void {
  const before = views.get(key(plugin, view));
  views.set(key(plugin, view), {
    ...info,
    plugin,
    view,
    message: before?.message ?? "",
    version: (before?.version ?? 0) + 1,
  });
  changed();
}

export function unregisterListView(plugin: string, view: string): void {
  if (views.delete(key(plugin, view))) changed();
}

export function listRefreshed(plugin: string, view: string): void {
  const info = views.get(key(plugin, view));
  if (!info) return;
  views.set(key(plugin, view), { ...info, version: info.version + 1 });
  changed();
}

export function setListMessage(
  plugin: string,
  view: string,
  message: string,
): void {
  const info = views.get(key(plugin, view));
  if (!info || info.message === message) return;
  views.set(key(plugin, view), { ...info, message });
  changed();
}

/** A plugin stopped: its lists go until it registers them again. */
export function forgetListViews(plugin: string): void {
  let any = false;
  for (const [k, info] of views)
    if (info.plugin === plugin) {
      views.delete(k);
      any = true;
    }
  if (any) changed();
}
