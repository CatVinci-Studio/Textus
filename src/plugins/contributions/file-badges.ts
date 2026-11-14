import { useSyncExternalStore } from "react";

/**
 * A short badge plugins put after a file's name in the sidebar
 * (`files.setBadge`): a draft's state, a count, a tag. One per file shows,
 * the plugin last by id winning; a plugin's go when it stops.
 */
type BadgeTone = "accent" | "warning" | "danger" | "success";
interface FileBadge {
  text: string;
  tone: BadgeTone | null;
  tooltip: string | null;
}

const MAX_TEXT = 12;
const TONES: readonly string[] = ["accent", "warning", "danger", "success"];
const byPath = new Map<string, Map<string, FileBadge>>();
const listeners = new Set<() => void>();
const told = () => listeners.forEach((listener) => listener());

function badgeOf(value: unknown): FileBadge {
  const v = (value ?? {}) as Record<string, unknown>;
  const text = typeof v.text === "string" ? v.text.trim() : "";
  if (!text || [...text].length > MAX_TEXT)
    throw new Error(`A badge's text is 1 to ${MAX_TEXT} characters.`);
  if (v.tone !== undefined && !TONES.includes(String(v.tone)))
    throw new Error(`tone is one of ${TONES.join(", ")}.`);
  return {
    text,
    tone: (v.tone as BadgeTone | undefined) ?? null,
    tooltip: typeof v.tooltip === "string" ? v.tooltip : null,
  };
}

/** Sets (or, with null, takes off) `plugin`'s badge on `path`. */
export function setFileBadge(
  plugin: string,
  path: string,
  badge: unknown,
): void {
  const own = byPath.get(path) ?? new Map<string, FileBadge>();
  if (badge === null || badge === undefined) own.delete(plugin);
  else own.set(plugin, badgeOf(badge));
  if (own.size) byPath.set(path, own);
  else byPath.delete(path);
  told();
}

/** Takes a stopped plugin's badges off. */
export function forgetFileBadges(plugin: string): void {
  let any = false;
  for (const [path, own] of byPath) {
    any = own.delete(plugin) || any;
    if (!own.size) byPath.delete(path);
  }
  if (any) told();
}

/** The badge `path` shows. */
export function fileBadge(path: string): FileBadge | null {
  const own = byPath.get(path);
  if (!own) return null;
  const last = [...own.keys()].sort().pop();
  return last ? own.get(last)! : null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `path`'s badge, following it as plugins change it. */
export function useFileBadge(path: string): FileBadge | null {
  return useSyncExternalStore(subscribe, () => fileBadge(path));
}
