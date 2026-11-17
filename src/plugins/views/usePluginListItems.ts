import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useLatest } from "../../utils/hooks/useLatest";
import { askPlugin } from "../manager";
import {
  listView,
  listViewsVersion,
  subscribeListViews,
} from "../contributions/list-views";
import type { PluginListItem } from "./PluginListView";

export function keyOf(item: PluginListItem, index: number): string {
  return item.id ?? `${index}:${item.label}`;
}

/**
 * A plugin list's items, asked when the list shows and on each refresh, with
 * the open items' children; the plugin is started first if needed.
 */
/** The list's last error, and `fail` to show one. */
function useListError() {
  const [error, setError] = useState<string | null>(null);
  const fail = useCallback(
    (err: unknown) => setError(String((err as Error)?.message ?? err)),
    [],
  );
  return { error, setError, fail };
}

/** The list the plugin registered, the plugin started on first show: it
 *  registers its list as it activates. */
function useListView(
  plugin: string,
  view: string,
  fail: (err: unknown) => void,
) {
  useSyncExternalStore(subscribeListViews, listViewsVersion);
  const info = listView(plugin, view);
  useEffect(() => {
    if (info) return;
    askPlugin(plugin, "$ping", {}).catch(fail);
  }, [plugin, info, fail]);
  return info;
}

export function usePluginListItems(plugin: string, view: string) {
  const { error, setError, fail } = useListError();
  const info = useListView(plugin, view, fail);
  const [items, setItems] = useState<PluginListItem[] | null>(null);
  const [children, setChildren] = useState<Map<string, PluginListItem[]>>(
    () => new Map(),
  );
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const ask = useCallback(
    (parent?: PluginListItem) =>
      askPlugin(plugin, "$listItems", { view, parent: parent ?? null }).then(
        (answer) => (Array.isArray(answer) ? (answer as PluginListItem[]) : []),
      ),
    [plugin, view],
  );

  // Read as they are when the list refreshes, not a reason to refresh.
  const state = useLatest({ open, items, children });
  const version = info?.version ?? 0;
  useEffect(() => {
    if (!version) return;
    let live = true;
    ask()
      .then((got) => {
        if (!live) return;
        setItems(got);
        setError(null);
        // An open item's children are asked again too, the item looked up
        // in the list just come. One not found (gone) is left: asked
        // without a parent, the plugin gives the top level, which would be
        // drawn again under it.
        const now = state.current;
        for (const id of now.open) {
          const parent = findItem(got, now.children, id);
          if (!parent) continue;
          void ask(parent)
            .then(
              (kids) => live && setChildren((m) => new Map(m).set(id, kids)),
            )
            .catch((err: unknown) => live && fail(err));
        }
      })
      .catch((err: unknown) => live && fail(err));
    return () => {
      live = false;
    };
  }, [ask, version, state, fail, setError]);

  const toggleOpen = (item: PluginListItem, key: string) => {
    const next = new Set(open);
    if (next.delete(key)) {
      setOpen(next);
      return;
    }
    next.add(key);
    setOpen(next);
    void ask(item)
      .then((got) => setChildren((m) => new Map(m).set(key, got)))
      .catch(fail);
  };

  /** One item put in another's place, at the top or among children. */
  const swapItem = (from: PluginListItem, to: PluginListItem) => {
    const swap = (list: PluginListItem[]) =>
      list.includes(from) ? list.map((i) => (i === from ? to : i)) : list;
    setItems((all) => (all ? swap(all) : all));
    setChildren((m) => {
      const next = new Map(m);
      for (const [key, list] of m) next.set(key, swap(list));
      return next;
    });
  };

  return { info, items, swapItem, children, open, toggleOpen, error, fail };
}

function findItem(
  top: PluginListItem[],
  children: Map<string, PluginListItem[]>,
  key: string,
): PluginListItem | null {
  const parts = key.split("/");
  let list = top;
  let prefix = "";
  let found: PluginListItem | null = null;
  for (const part of parts) {
    const index = list.findIndex((item, i) => keyOf(item, i) === part);
    if (index < 0) return null;
    found = list[index];
    prefix = prefix ? `${prefix}/${part}` : part;
    list = children.get(prefix) ?? [];
  }
  return found;
}
