import { useEffect, useRef, useState } from "react";
import { fs } from "../platform/ipc";
import { isFarUrl } from "../platform/far-files";
import { listenToThisWindow, unlistenAll } from "../platform/events";
import { createSubscribers } from "../utils/store";

/** The tree's folders that are open, each counted once per row showing it;
 *  what the disk watch follows. */
export class OpenFolders {
  private readonly counts = new Map<string, number>();
  private readonly listeners = createSubscribers();

  subscribe = this.listeners.subscribe;

  /** `path` is open; the returned function closes it again. */
  add = (path: string): (() => void) => {
    this.counts.set(path, (this.counts.get(path) ?? 0) + 1);
    this.listeners.publish();
    return () => {
      const n = (this.counts.get(path) ?? 1) - 1;
      if (n > 0) this.counts.set(path, n);
      else this.counts.delete(path);
      this.listeners.publish();
    };
  };

  list(): string[] {
    return [...this.counts.keys()];
  }
}

/** What the watch sends (src-tauri/src/commands/fs/watch.rs `DirsChanged`). */
interface DirsChanged {
  dirs: string[];
  all: boolean;
}

/** The watch's calls, numbered: growing across the page loading again, as
 *  the backend passes over one older than the last it had. */
let watchCalls = Date.now();

/** Open folders gathered this long before the watch is told. */
const SETTLE_MS = 50;

/**
 * The open folders read again as other apps change them on disk: `refresh`
 * with the folders changed. Returns a count bumped when every open folder
 * must be read again: the system lost track, or where nothing watches (a
 * phone, a remote folder, the system's limit reached), each time the window
 * comes back to the front.
 */
export function useDiskWatch(
  open: OpenFolders,
  refresh: (...dirs: string[]) => void,
): number {
  const [count, setCount] = useState(0);
  const live = useRef(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let asked = 0;
    const tell = () => {
      const dirs = open.list();
      const near = dirs.filter((dir) => !isFarUrl(dir));
      const ask = ++asked;
      fs.watchFolders(near, ++watchCalls).then(
        (ok) => {
          if (ask === asked) live.current = ok && near.length === dirs.length;
        },
        () => {
          if (ask === asked) live.current = false;
        },
      );
    };
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(tell, SETTLE_MS);
    };
    const stopOpen = open.subscribe(changed);
    changed();
    const onFocus = () => {
      if (!live.current) setCount((n) => n + 1);
    };
    window.addEventListener("focus", onFocus);
    const stopEvents = unlistenAll(
      listenToThisWindow<DirsChanged>("tree-dirs-changed", ({ payload }) => {
        if (payload.all) setCount((n) => n + 1);
        else if (payload.dirs.length) refresh(...payload.dirs);
      }),
    );
    return () => {
      clearTimeout(timer);
      stopOpen();
      stopEvents();
      window.removeEventListener("focus", onFocus);
      live.current = false;
      void fs.watchFolders([], ++watchCalls).catch(() => {});
    };
  }, [open, refresh]);
  return count;
}
