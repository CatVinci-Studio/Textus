import { useMemo } from "react";
import { fill } from "../i18n/fill";
import { counted } from "../i18n/current";
import type { Strings } from "../i18n/strings";
import { showChoice, showMessage } from "../engine/controls/app-dialog";
import { showNotice } from "../engine/controls/notices";
import { fs } from "../platform/ipc";
import { useLatest } from "../utils/hooks/useLatest";
import {
  basename,
  folderName,
  isWithin,
  joinPath,
  parentDir,
} from "../utils/path";
import type { CopyNaming } from "../platform/bindings/files";
import {
  copyIn,
  exists,
  movedStep,
  trashEach,
  type FileStep,
} from "./file-undo";
import { updateLinksAfterMove } from "./move-links";
import { failureText, trashFromTree } from "./tree-shared";
import { outermost, type TreeRow, type TreeSelection } from "./tree-selection";
import type { FileUndo } from "./useFileUndo";

/** Whether the entry at `path` is a folder, as its folder lists it;
 *  `guess` when it can't be read. */
async function kindAt(path: string, guess: boolean): Promise<boolean> {
  const dir = parentDir(path);
  const name = basename(path).toLowerCase();
  const entries = dir ? await fs.listDir(dir).catch(() => []) : [];
  return entries.find((e) => e.name.toLowerCase() === name)?.is_dir ?? guess;
}

/** What the tree does with rows taken to a folder. */
type TransferHow = "move" | "copy";

/** What a name already taken in the folder becomes, as asked. */
type Clash = "replace" | "keepBoth";

/**
 * Rows moved or copied into a folder from the tree: a drag (⌥ or Ctrl
 * copies), a paste, Duplicate. A copy into its own folder is named as a
 * file manager names one ("plan copy.md"); a name taken there asks Replace
 * (the old one to the Trash), Keep Both (numbered) or Cancel. Links follow
 * a move; the whole is one step to undo, said in a notice with its Undo;
 * the first new row is picked and has the keyboard.
 */
export function useTreeTransfer(input: {
  /** The folder whose documents' links follow a move, and the Trash's
   *  edge. */
  folder: string;
  t: Strings;
  reload: (...dirs: string[]) => void;
  onEntryMoved: (from: string, to: string) => void;
  fileUndo: FileUndo;
  selection: TreeSelection;
}) {
  const latest = useLatest(input);
  return useMemo(() => {
    /** Asks what a taken name becomes; null to stop. */
    const askClash = async (name: string, into: string) => {
      const { t } = latest.current;
      const answer = await showChoice(
        fill(t.treeNameClash, { name, folder: folderName(into) }),
        {
          okLabel: t.treeReplace,
          altLabel: t.treeKeepBoth,
          cancelLabel: t.cancel,
        },
      );
      return answer === "ok" ? "replace" : answer === "alt" ? "keepBoth" : null;
    };

    /** One row taken into `into`: its new path and steps, or null when it
     *  stays (a cut pasted where it is). Throws what the backend refused. */
    const one = async (
      row: TreeRow,
      into: string,
      how: TransferHow,
      clash: Clash | null,
      steps: FileStep[],
    ): Promise<string | null> => {
      const { folder, t, reload, onEntryMoved } = latest.current;
      const here = parentDir(row.path) === into;
      if (how === "move" && here) return null;
      if (clash === "replace") {
        const old = joinPath(into, basename(row.path));
        const isDir = await kindAt(old, row.isDir);
        const { trashed, failed } = await trashEach(
          [{ path: old, isDir }],
          (paths) => trashFromTree(paths, folder, reload),
        );
        if (failed) throw failed.error;
        if (trashed.length) steps.push({ kind: "trashed", trashed });
      }
      if (how === "move") {
        const to = await fs.moveEntry(
          row.path,
          into,
          undefined,
          clash === "keepBoth",
        );
        reload(parentDir(row.path) ?? into, into);
        onEntryMoved(row.path, to);
        steps.push(
          movedStep(
            row.path,
            to,
            updateLinksAfterMove(row.path, to, folder, t),
          ),
        );
        return to;
      }
      const naming: CopyNaming = here
        ? { beside: t.treeCopyName }
        : clash === "keepBoth"
          ? "numbered"
          : "own";
      const { copy, made } = await copyIn(
        row.path,
        row.isDir,
        into,
        naming,
        reload,
      );
      if (made) steps.push({ kind: "made", made: [made] });
      return copy;
    };

    /** `rows` into the folder `to`, or each beside itself (null, as
     *  Duplicate); true when any went. */
    const transfer = async (
      rows: readonly TreeRow[],
      to: string | null,
      how: TransferHow,
    ): Promise<boolean> => {
      const { t, fileUndo, selection } = latest.current;
      const steps: FileStep[] = [];
      const made: TreeRow[] = [];
      for (const row of outermost(rows)) {
        const into = to ?? parentDir(row.path);
        if (into === null) continue;
        const name = basename(row.path);
        const target = joinPath(into, name);
        const here = parentDir(row.path) === into;
        // Never into itself, nor over a folder it is in.
        if (row.isDir && isWithin(into, row.path)) {
          await showMessage(failureText(t, "[moveIntoItself]", name));
          break;
        }
        let clash: Clash | null = null;
        if (!here && (await exists(target))) {
          if (isWithin(row.path, target)) continue;
          clash = await askClash(name, into);
          if (!clash) break;
        }
        try {
          const path = await one(row, into, how, clash, steps);
          if (path) made.push({ path, isDir: row.isDir });
        } catch (err) {
          await showMessage(failureText(t, err, name));
          break;
        }
      }
      // What was done is kept to undo, even an old one trashed to make way
      // for what then failed.
      const undo = steps.length
        ? fileUndo.record(
            steps.length === 1 ? steps[0]! : { kind: "steps", steps },
          )
        : undefined;
      const [first] = made;
      if (!first) return false;
      if (made.length === 1) selection.only(first);
      else selection.clear();
      fileUndo.show(first.path);
      const where = {
        folder: folderName(to ?? parentDir(first.path) ?? first.path),
      };
      const said = how === "move" ? t.treeMoved : t.treeCopied;
      showNotice(fill(counted(said, made.length), where), { action: undo });
      return true;
    };
    return { transfer };
  }, [latest]);
}

export type TreeTransfer = ReturnType<typeof useTreeTransfer>;
