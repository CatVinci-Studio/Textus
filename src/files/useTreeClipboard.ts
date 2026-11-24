import { useEffect, useMemo, type RefObject } from "react";
import { copyPath } from "../clipboard/copy-path";
import { useLatest } from "../utils/hooks/useLatest";
import { parentDir } from "../utils/path";
import { fileClipboard, pathsText } from "./file-clipboard";
import { rowOfEvent, type TreeRow } from "./tree-selection";
import type { TreeTransfer } from "./useTreeTransfer";

/** The rows a command on the row `el` acts on: the picked ones if it is
 *  one of them, else itself. */
type RowsAt = (el: HTMLElement) => readonly TreeRow[];

/**
 * Cut, Copy, Paste and Duplicate for the tree's rows (file-clipboard.ts
 * holds what was taken). A paste goes into the folder of the row, or the
 * row itself if it is one; after a Cut it moves them, after a Copy it
 * copies them. On a Mac the Edit menu's items reach the tree as the page's
 * clipboard events, which it claims while a row has the keyboard (the
 * `before…` events turn the items on); other systems use the keys
 * (useTreeCommands.ts).
 */
export function useTreeClipboard(input: {
  treeRef: RefObject<HTMLDivElement | null>;
  transfer: TreeTransfer["transfer"];
  rowsAt: RowsAt;
}) {
  const latest = useLatest(input);
  const clip = useMemo(
    () => ({
      take(rows: readonly TreeRow[], cut: boolean) {
        fileClipboard.set({ rows, cut });
      },
      async paste(into: string) {
        const held = fileClipboard.get();
        if (!held) return;
        const done = await latest.current.transfer(
          held.rows,
          into,
          held.cut ? "move" : "copy",
        );
        // What was cut is where it goes now: nothing left to paste.
        if (done && held.cut) fileClipboard.set(null);
      },
      duplicate(rows: readonly TreeRow[]) {
        void latest.current.transfer(rows, null, "copy");
      },
      /** Where a paste on the row `el` goes. */
      pasteInto(el: HTMLElement): string {
        const path = el.dataset.path!;
        return el.hasAttribute("aria-expanded")
          ? path
          : (parentDir(path) ?? path);
      },
    }),
    [latest],
  );

  useEffect(() => {
    const claim = (e: ClipboardEvent) => {
      const row = rowOfEvent(
        { target: document.activeElement },
        latest.current.treeRef.current,
      );
      if (!row) return;
      e.preventDefault();
      if (e.type.startsWith("before")) return;
      e.stopImmediatePropagation();
      if (e.type === "paste") return void clip.paste(clip.pasteInto(row));
      const rows = latest.current.rowsAt(row);
      clip.take(rows, e.type === "cut");
      e.clipboardData?.setData("text/plain", pathsText(rows));
    };
    const kinds = [
      "beforecut",
      "beforecopy",
      "beforepaste",
      "cut",
      "copy",
      "paste",
    ];
    for (const kind of kinds)
      document.addEventListener(kind, claim as EventListener, true);
    return () => {
      for (const kind of kinds)
        document.removeEventListener(kind, claim as EventListener, true);
    };
  }, [latest, clip]);

  return useMemo(
    () => ({
      ...clip,
      /** Cut or Copy from a key or a menu: the system's clipboard gets
       *  the paths as text too. */
      cutOrCopy(rows: readonly TreeRow[], cut: boolean) {
        clip.take(rows, cut);
        copyPath(pathsText(rows));
      },
    }),
    [clip],
  );
}

export type TreeClipboard = ReturnType<typeof useTreeClipboard>;
