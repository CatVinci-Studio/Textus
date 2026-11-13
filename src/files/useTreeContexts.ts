import { useMemo } from "react";
import { windowIpc } from "../platform/ipc";
import type { TreeDraft, TreeRowActions, TreeShared } from "./tree-shared";

const openInNewWindow = (path: string) =>
  void windowIpc.openPathInNewWindow(path).catch(() => undefined);

/** What the tree's rows read: the folders' state, and the row actions apart
 *  from it, which keep while the folders are read again. */
export function useTreeContexts(
  input: Omit<TreeShared, keyof TreeRowActions | "newDocument" | "dropInto"> & {
    desktop: boolean;
    dropInto: string | null | undefined;
    onRowMenu: NonNullable<TreeRowActions["onRowMenu"]>;
    onRowPointerDown: NonNullable<TreeRowActions["onRowPointerDown"]>;
    newDocumentLabel: string;
    setDraft: (draft: TreeDraft) => void;
    root: string;
  },
): { rowActions: TreeRowActions; shared: TreeShared } {
  const { desktop, onRowMenu, onRowPointerDown } = input;
  const rowActions = useMemo<TreeRowActions>(
    () => ({
      onRowMenu: desktop ? onRowMenu : null,
      onRowPointerDown: desktop ? onRowPointerDown : null,
      openInNewWindow: desktop ? openInNewWindow : null,
    }),
    [desktop, onRowMenu, onRowPointerDown],
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
