import { useSyncExternalStore } from "react";
import { storage, type HistoryKind } from "../platform/ipc";
import { readBoot } from "./boot";
import { readLocalJson } from "./local";
import { trackWrite } from "./pending-writes";
import { listenToThisWindow } from "../utils/tauri-events";

/** A small persisted list as an external store, synced across windows. Rust
 *  changes it one entry at a time, so concurrent saves from two windows both
 *  land; without Rust it lives in localStorage. Loaded entries pass `isEntry`. */
export function createPersistedList<T, Saved extends T = T>(
  key: string,
  options: {
    kind: HistoryKind;
    max: number;
    isEntry: (value: unknown) => value is T;
    /** What makes two entries the same one. */
    keyOf: (entry: T) => string;
    /** Order kept on every change, e.g. most recent first. */
    sort?: (a: T, b: T) => number;
    /** The form an entry is stored in, applied to every write and, file-backed,
     *  to loaded entries, which are written back if it changes them. Must return
     *  an entry already in that form unchanged (the same object). */
    normalise?: <E extends T>(entry: E) => E;
    /** File-backed, the part of a saved entry the list holds when Rust keeps the
     *  rest elsewhere. The localStorage fallback keeps whole entries. */
    listed?: (entry: Saved) => T;
    /** How an entry loaded in an older form is written back in the one
     *  `normalise` gives it; by default, an upsert of it. */
    rewrite?: (stored: T, normalised: T) => Promise<unknown>;
  },
) {
  const listeners = new Set<() => void>();
  let entries: T[] = [];
  let started = false;
  /** File mode: the latest list request, with the operations made since,
   *  replayed onto its answer (they are idempotent). A newer request
   *  supersedes an older one, whose answer is dropped. */
  let request: { ops: Op<T>[] } | null = null;

  function tidy(list: unknown[]): T[] {
    const valid = list.filter(options.isEntry);
    if (options.sort) valid.sort(options.sort);
    return valid.slice(0, options.max);
  }

  function apply(list: T[], op: Op<T>): T[] {
    switch (op.type) {
      case "upsert": {
        const k = options.keyOf(op.entry);
        return tidy([op.entry, ...list.filter((e) => options.keyOf(e) !== k)]);
      }
      case "remove":
        return list.filter((e) => options.keyOf(e) !== op.key);
      case "clear":
        return [];
    }
  }

  function notify() {
    for (const fn of listeners) fn();
  }

  function loadLocal(): T[] {
    const parsed = readLocalJson(key);
    return Array.isArray(parsed) ? tidy(parsed) : [];
  }

  function fetchList() {
    const mine: { ops: Op<T>[] } = { ops: [] };
    request = mine;
    void storage
      .historyList(options.kind)
      .then((list) => {
        if (request !== mine) return;
        let next = tidy(Array.isArray(list) ? list : []);
        for (const op of mine.ops) next = apply(next, op);
        request = null;
        // After the replay: an entry removed meanwhile stays removed, and
        // the ones upserted meanwhile went out normalised already.
        const outdated = options.normalise
          ? next.filter((entry) => options.normalise!(entry) !== entry)
          : [];
        entries = next;
        notify();
        for (const entry of outdated) rewrite(entry);
      })
      .catch(() => {
        if (request === mine) request = null;
      });
  }

  function start() {
    if (started) return;
    started = true;
    const boot = readBoot();
    if (!boot) {
      entries = loadLocal();
      if (typeof window !== "undefined") {
        window.addEventListener("storage", (e) => {
          if (e.key !== key) return;
          entries = loadLocal();
          notify();
        });
      }
      return;
    }
    void listenToThisWindow<HistoryChanged<T>>("history-changed", (event) => {
      const { kind, op, from } = event.payload;
      if (kind !== options.kind) return;
      if (op.type === "reload") return fetchList();
      // This window's own change, already applied when it was made.
      if (from === boot.label) return;
      request?.ops.push(op);
      entries = apply(entries, op);
      notify();
    });
    fetchList();
  }

  /** An entry loaded in an older form: in its new one here at once, and
   *  written back. */
  function rewrite(stored: T) {
    // Without `rewrite` a list holds whole entries: what it holds is saved.
    if (!options.rewrite)
      return change({ type: "upsert", entry: stored as Saved });
    const entry = options.normalise!(stored);
    const op: Op<T> = { type: "upsert", entry };
    request?.ops.push(op);
    entries = apply(entries, op);
    trackWrite(options.rewrite(stored, entry)).catch(() => {});
    notify();
  }

  /** Applies `op` here at once, then hands it to the store behind. */
  function change(op: Op<Saved>) {
    start();
    if (op.type === "upsert" && options.normalise)
      op = { type: "upsert", entry: options.normalise(op.entry) };
    if (readBoot()) {
      const local: Op<T> =
        op.type === "upsert" && options.listed
          ? { type: "upsert", entry: options.listed(op.entry) }
          : op;
      entries = apply(entries, local);
      request?.ops.push(local);
      const sent =
        op.type === "upsert"
          ? storage.historyUpsert(options.kind, op.entry)
          : op.type === "remove"
            ? storage.historyRemove(options.kind, op.key)
            : storage.historyClear(options.kind);
      // A failed write just won't survive the session; a closing window waits
      // for it, though.
      trackWrite(sent).catch(() => {});
    } else {
      entries = apply(entries, op);
      try {
        localStorage.setItem(key, JSON.stringify(entries));
      } catch {
        // Quota exceeded or storage unavailable - same as above.
      }
    }
    notify();
  }

  function subscribe(fn: () => void): () => void {
    start();
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    get: (): T[] => {
      start();
      return entries;
    },
    /** Adds `entry`, or replaces the one with the same key, at the front
     *  (then `sort` and the cap apply). */
    upsert: (entry: Saved) => change({ type: "upsert", entry }),
    remove: (entryKey: string) => change({ type: "remove", key: entryKey }),
    clear: () => change({ type: "clear" }),
    useEntries: (): T[] => useSyncExternalStore(subscribe, () => entries),
  };
}

type Op<T> =
  | { type: "upsert"; entry: T }
  | { type: "remove"; key: string }
  | { type: "clear" };

interface HistoryChanged<T> {
  kind: HistoryKind;
  op: Op<T> | { type: "reload" };
  from: string;
}
