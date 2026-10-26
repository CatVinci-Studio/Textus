/**
 * Items added from outside (plugins) to the file tree's, a tab's and a
 * view's menus. Each menu asks when it opens.
 */
export type ContextMenuPlace = "file/context" | "tab/context" | "view/title";

/** What the menu was opened on. */
export interface ContextMenuTarget {
  /** The file, or the tab's file (null for a tab without one). */
  path: string | null;
  /** For "view/title": the view's id. */
  view?: string;
}

export interface ContributedItem {
  label: string;
  /** For "view/title": an icon in place of the label. */
  icon?: string;
  plugin: string;
  onSelect: () => void;
}

type Provider = (target: ContextMenuTarget) => ContributedItem[];

const providers = new Map<ContextMenuPlace, Provider[]>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  for (const listener of listeners) listener();
}

export function registerContextItems(
  place: ContextMenuPlace,
  provider: Provider,
): () => void {
  const list = providers.get(place) ?? [];
  list.push(provider);
  providers.set(place, list);
  changed();
  return () => {
    const at = list.indexOf(provider);
    if (at >= 0) list.splice(at, 1);
    changed();
  };
}

/** The items for a menu opened on `target`. A provider that throws adds
 *  nothing rather than taking the menu down. */
export function contributedContextItems(
  place: ContextMenuPlace,
  target: ContextMenuTarget,
): ContributedItem[] {
  return (providers.get(place) ?? []).flatMap((provider) => {
    try {
      return provider(target);
    } catch {
      return [];
    }
  });
}

/** For buttons that show without a menu being opened (view/title). */
export function subscribeContextItems(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function contextItemsVersion(): number {
  return version;
}
