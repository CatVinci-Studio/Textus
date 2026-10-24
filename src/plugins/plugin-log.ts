/**
 * What went wrong in each plugin lately - its code's errors, a call that
 * failed, its being turned off - for its page in Settings, where a
 * developer (or Textus AI writing a plugin) reads why. In memory only, the
 * last LIMIT of each.
 */

export interface PluginLogEntry {
  at: number;
  message: string;
}

const LIMIT = 50;
const logs = new Map<string, PluginLogEntry[]>();
const listeners = new Set<() => void>();
let version = 0;

export function logPluginError(id: string, message: string): void {
  const list = logs.get(id) ?? [];
  list.push({ at: Date.now(), message: message.slice(0, 2000) });
  logs.set(id, list.slice(-LIMIT));
  version++;
  for (const fn of listeners) fn();
}

export function pluginLog(id: string): readonly PluginLogEntry[] {
  return logs.get(id) ?? [];
}

export function clearPluginLog(id: string): void {
  if (!logs.delete(id)) return;
  version++;
  for (const fn of listeners) fn();
}

/** For useSyncExternalStore. */
export function subscribePluginLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function pluginLogVersion(): number {
  return version;
}
