import { useEffect, useState } from "react";

/**
 * Views that are heavy to keep (a web page's WebKit process, a plugin's
 * page) and cheap to load again: one out of sight for `hiddenMs` is let
 * go, and no more than `max` of a kind stay loaded, the longest unseen
 * going first. Shown again, it loads afresh.
 */
export const KEEP_HIDDEN_MS = 5 * 60_000;

interface Kept {
  visible: boolean;
  seen: number;
  unload: () => void;
}

const groups = new Map<string, Map<object, Kept>>();

export interface KeptHandle {
  /** On screen now: kept, and others of its kind beyond `max` let go. */
  shown(): void;
  /** Out of sight: let go after `hiddenMs`. */
  hidden(): void;
  /** Gone for good (its tab closed). */
  drop(): void;
}

export interface KeepOptions {
  hiddenMs?: number;
  max?: number;
}

export function keepLoaded(
  group: string,
  unload: () => void,
  { hiddenMs = KEEP_HIDDEN_MS, max = 3 }: KeepOptions = {},
): KeptHandle {
  const kept = groups.get(group) ?? new Map<object, Kept>();
  groups.set(group, kept);
  const key = {};
  let timer = 0;
  const entry: Kept = {
    visible: false,
    seen: Date.now(),
    unload: () => {
      kept.delete(key);
      clearTimeout(timer);
      unload();
    },
  };
  const later = () => entry.unload();
  return {
    shown() {
      entry.visible = true;
      entry.seen = Date.now();
      clearTimeout(timer);
      kept.set(key, entry);
      const hidden = [...kept.values()]
        .filter((k) => !k.visible)
        .sort((a, b) => a.seen - b.seen);
      while (kept.size > max && hidden.length) hidden.shift()!.unload();
    },
    hidden() {
      entry.visible = false;
      entry.seen = Date.now();
      clearTimeout(timer);
      timer = window.setTimeout(later, hiddenMs);
    },
    drop() {
      clearTimeout(timer);
      kept.delete(key);
    },
  };
}

/** Whether a view of `group` should be mounted: true while `visible`, and
 *  for a while after; false once let go, until shown again. */
export function useKeptLoaded(
  group: string,
  visible: boolean,
  options?: KeepOptions,
): boolean {
  const [loaded, setLoaded] = useState(visible);
  const [handle] = useState(() =>
    keepLoaded(group, () => setLoaded(false), options),
  );
  useEffect(() => {
    if (visible) {
      setLoaded(true);
      handle.shown();
    } else handle.hidden();
  }, [visible, handle]);
  useEffect(() => () => handle.drop(), [handle]);
  return loaded;
}
