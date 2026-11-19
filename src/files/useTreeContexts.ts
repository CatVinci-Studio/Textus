import { useMemo } from "react";
import type { TreeDraft, TreeRowActions, TreeShared } from "./tree-shared";

/** What the tree's rows read: the folders' state, and the row actions apart
 *  from it, which keep while the folders are read again. */
export function useTreeContexts(
  input: Omit<TreeShared, keyof TreeRowActions | "newDocument" | "dropInto"> & {
    desktop: boolean;
    dropInto: string | null | undefined;
    onRowMenu: NonNullable<TreeRowActions["onRowMenu"]>;
    onRowPointerDown: NonNullable<TreeRowActions["onRowPointerDown"]>;
    onRowPick: NonNullable<TreeRowActions["onRowPick"]>;
    newDocumentLabel: string;
    setDraft: (draft: TreeDraft) => void;
    root: string;
  },
): { rowActions: TreeRowActions; shared: TreeShared } {
  const { desktop, onRowMenu, onRowPointerDown, onRowPick } = input;
  // Every screen: a finger's hold lifts a row, a trackpad right-clicks it.
  const rowActions = useMemo<TreeRowActions>(
    () => ({ onRowMenu, onRowPointerDown, onRowPick }),
    [onRowMenu, onRowPointerDown, onRowPick],
  );
  const {
    sort,
    scope,
    showHidden,
    versions,
    stale,
    refreshed,
    dropInto,
    draft,
    finishDraft,
    newDocumentLabel,
    setDraft,
    root,
    reveal,
  } = input;
  const shared = useMemo<TreeShared>(
    () => ({
      sort,
      scope,
      showHidden,
      versions,
      stale,
      refreshed,
      dropInto: dropInto ?? null,
      ...rowActions,
      draft,
      finishDraft,
      newDocument: desktop
        ? {
            label: newDocumentLabel,
            start: () => setDraft({ dir: root, kind: "document" }),
          }
        : null,
      reveal,
    }),
    [
      sort,
      scope,
      showHidden,
      versions,
      stale,
      refreshed,
      dropInto,
      desktop,
      rowActions,
      draft,
      finishDraft,
      setDraft,
      root,
      newDocumentLabel,
      reveal,
    ],
  );
  return { rowActions, shared };
}
