import { createSubscribers } from "../utils/store";
/**
 * Items added from outside (plugins) to the file tree's, a tab's, a
 * view's and a floating view's menus. Each menu asks when it opens.
 */
export type ContextMenuPlace =
  "file/context" | "tab/context" | "view/title" | "floating/context";

/** What the menu was opened on. */
interface ContextMenuTarget {
  /** The file, or the tab's file (null for a tab without one). */
  path: string | null;
  /** For "file/context": a folder, not a file. */
  folder?: boolean;
  /** For "view/title" and "floating/context": the view's id. */
  view?: string;
}

interface ContributedItem {
  label: string;
  /** For "view/title": an icon in place of the label. */
  icon?: string;
  plugin: string;
  onSelect: () => void;
}

type Provider = (target: ContextMenuTarget) => ContributedItem[];

const providers = new Map<ContextMenuPlace, Provider[]>();
const subscribers = createSubscribers();
let version = 0;

function changed() {
  version++;
  subscribers.publish();
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

/** Menus whose plugin items may be worked out as they open. */
export type LateMenuPlace = "editor/context" | "file/context";

/** What such a menu was opened on. */
export interface LateMenuTarget {
  path: string | null;
  folder?: boolean;
  /** For "editor/context": the selected text, "" for none. */
  selectedText?: string;
}

type LateProvider = (target: LateMenuTarget) => Promise<ContributedItem[]>;

const lateProviders = new Map<LateMenuPlace, LateProvider[]>();

/** A provider that answers as the menu opens (a plugin's, over its
 *  channel), until the returned function takes it away. */
export function registerLateContextItems(
  place: LateMenuPlace,
  provider: LateProvider,
): () => void {
  const list = lateProviders.get(place) ?? [];
  list.push(provider);
  lateProviders.set(place, list);
  return () => {
    const at = list.indexOf(provider);
    if (at >= 0) list.splice(at, 1);
  };
}

/** How long an opening menu waits for a provider before leaving it out. */
const LATE_WAIT_MS = 500;

/** What the late providers add for a menu opened on `target`: those that
 *  answer in time, in their order; null when none is registered, so the
 *  menu needn't wait at all. */
export function lateContextItems(
  place: LateMenuPlace,
  target: LateMenuTarget,
): Promise<ContributedItem[]> | null {
  const list = lateProviders.get(place) ?? [];
  if (!list.length) return null;
  const late = new Promise<ContributedItem[]>((resolve) =>
    setTimeout(() => resolve([]), LATE_WAIT_MS),
  );
  return Promise.all(
    list.map((provide) =>
      Promise.race([provide(target).catch(() => []), late]),
    ),
  ).then((groups) => groups.flat());
}

/** For buttons that show without a menu being opened (view/title). */
export const subscribeContextItems = subscribers.subscribe;

export function contextItemsVersion(): number {
  return version;
}
