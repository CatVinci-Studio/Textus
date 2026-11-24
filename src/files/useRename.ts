import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import { fs } from "../platform/ipc";
import type { Strings } from "../i18n/strings";
import { createSubscribers } from "../utils/store";
import { useLatest } from "../utils/hooks/useLatest";
import { parentDir } from "../utils/path";
import { updateLinksAfterMove } from "./move-links";
import { failureText } from "./tree-shared";
import type { FileUndo } from "./useFileUndo";

/** The row whose name is being typed in place, if any. */
class Renaming {
  path: string | null = null;
  private readonly listeners = createSubscribers();
  subscribe = this.listeners.subscribe;
  set(path: string | null) {
    if (path === this.path) return;
    this.path = path;
    this.listeners.publish();
  }
}

/** A row's rename in place: its name given, or given up; `byKey`: ended
 *  with a key, the keyboard back on the row (NameField). */
export interface RowRename {
  commit: (
    path: string,
    name: string,
    byKey: boolean,
  ) => Promise<string | null>;
  cancel: (path: string, byKey: boolean) => void;
}

const RenameContext = createContext<{
  renaming: Renaming;
  rename: RowRename;
} | null>(null);

export const RenameProvider = RenameContext.Provider;

/** Whether the row of `path` is being renamed, and how it finishes. */
export function useRowRename(path: string): RowRename | null {
  const shared = useContext(RenameContext);
  const on = useSyncExternalStore(
    shared?.renaming.subscribe ?? noSubscribe,
    () => shared?.renaming.path === path,
  );
  return on && shared ? shared.rename : null;
}

const noSubscribe = () => () => {};

/**
 * Renaming a row in place (its one owner): `start` turns the row's name
 * into a field; the name given renames it, open tabs and links following,
 * as one step to undo; a taken name is said under the field.
 */
export function useRename(input: {
  /** The folder whose documents' links follow. */
  linkBase: string;
  t: Strings;
  reload: (...dirs: string[]) => void;
  onEntryMoved: (from: string, to: string) => void;
  fileUndo: FileUndo;
}) {
  const latest = useLatest(input);
  const renaming = useMemo(() => new Renaming(), []);
  const rename = useMemo<RowRename>(
    () => ({
      async commit(path, name, byKey) {
        const { linkBase, t, reload, onEntryMoved, fileUndo } = latest.current;
        let to: string;
        try {
          to = await fs.renameEntry(path, name);
        } catch (err) {
          return failureText(t, err, name);
        }
        renaming.set(null);
        reload(parentDir(path) ?? linkBase);
        onEntryMoved(path, to);
        if (byKey) fileUndo.show(to);
        if (to !== path)
          fileUndo.record({
            kind: "moved",
            moved: [{ from: path, to }],
            edits: updateLinksAfterMove(path, to, linkBase, t).catch(() => []),
          });
        return null;
      },
      cancel(path, byKey) {
        renaming.set(null);
        if (byKey) latest.current.fileUndo.show(path);
      },
    }),
    [latest, renaming],
  );
  return useMemo(
    () => ({
      renameShared: { renaming, rename },
      startRename: (path: string) => renaming.set(path),
    }),
    [renaming, rename],
  );
}
