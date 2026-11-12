import { isError } from "../utils/error-text";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import { canOpenFolder, canUseWindows } from "../platform/capabilities";
import { takeWindowSession } from "../document/launch-window";
import { fs, session, windowIpc } from "../platform/ipc";
import { getUiState, setUiState } from "../storage/ui-state";
import { useSettings } from "../prefs/SettingsContext";
import { showMessage } from "../engine/controls/app-dialog";
import { dirname, isInside } from "../utils/path";
import { SHOW_FOLDER_EVENT } from "../utils/events";
import {
  agentRootOnClose,
  agentRootOnOpen,
  nextTreeRoot,
} from "../files/tree-root";

/** The folder the last session had open, where there are no windows (an
 *  iPad); a desktop window's comes with its session (launch-window.ts). */
function restoredFolder(restoreSession: boolean): string | null {
  if (!canOpenFolder || !restoreSession || canUseWindows) return null;
  const saved = getUiState("openFolder");
  return typeof saved === "string" && saved ? saved : null;
}

/** The folder an earlier version kept for the whole app: taken by the first
 *  window to restore, once. */
function olderFolder(): string | null {
  const saved = getUiState("openFolder");
  if (!saved) return null;
  setUiState("openFolder", null);
  return typeof saved === "string" ? saved : null;
}

function agentRootFromFolder(): string {
  const saved = getUiState("agentRootFromFolder");
  return typeof saved === "string" ? saved : "";
}

/** What the tree root was worked out from: when these change, the root is
 *  worked out again (nextTreeRoot), and only then. */
function inputsKey(
  folder: string | null,
  docPath: string | null,
  fallback: string | null,
) {
  return [folder ?? "", docPath ?? "", fallback ?? ""].join("\n");
}

/**
 * One window's opened folder and sidebar tree root. The folder pins the root;
 * without one the tree follows the document in front. It also becomes the
 * AI's project folder unless the user chose another.
 */
export function useOpenFolder({
  activePath,
  fallback,
  onOpened,
  folderTooBroad,
}: {
  activePath: string | null;
  /** The tree's root with no document saved (iOS: Documents). */
  fallback: string | null;
  /** Brings the Files tab into view once a folder opens. */
  onOpened: () => void;
  /** The refusal shown for the home folder or a drive root. */
  folderTooBroad: string;
}) {
  const { settings, setSettings } = useSettings();
  const [folder, setFolder] = useState<string | null>(() =>
    restoredFolder(settings.restoreSessionOnStartup),
  );
  const [tree, setTree] = useState(() => ({
    key: inputsKey(folder, activePath, fallback),
    root: nextTreeRoot({
      current: null,
      folder,
      docPath: activePath,
      fallback,
    }),
  }));
  // Worked out while rendering, not in an effect: the tree never draws a
  // frame at a root it is about to leave.
  const key = inputsKey(folder, activePath, fallback);
  let treeRoot = tree.root;
  if (tree.key !== key) {
    treeRoot = nextTreeRoot({
      current: tree.root,
      folder,
      docPath: activePath,
      fallback,
    });
    setTree({ key, root: treeRoot });
  }
  const setTreeRoot = useCallback(
    (root: string) => setTree((prev) => ({ ...prev, root })),
    [],
  );
  // A plugin's textus.showFolder: a folder inside the open one, only. The
  // opened folder stays the root and opens down to it; without one, the
  // tree narrows to it.
  const [revealed, setRevealed] = useState<string | null>(null);
  useEffect(() => {
    const show = (event: Event) => {
      const path = (event as CustomEvent<unknown>).detail;
      const top = folder ?? treeRoot;
      if (typeof path !== "string" || !top || !isInside(path, top)) return;
      if (folder) setRevealed(path);
      else setTreeRoot(path);
    };
    window.addEventListener(SHOW_FOLDER_EVENT, show);
    return () => window.removeEventListener(SHOW_FOLDER_EVENT, show);
  }, [folder, treeRoot, setTreeRoot]);

  // Read when a folder opens or closes, not captured: the menu bridge and
  // the pending-folder drain call these from long-lived handlers.
  const latest = useRef({
    folder,
    settings,
    setSettings,
    activePath,
    fallback,
  });
  useEffect(() => {
    latest.current = { folder, settings, setSettings, activePath, fallback };
  });

  const openFolder = useCallback(
    (path: string) => {
      const now = latest.current;
      setFolder(path);
      setTree({
        key: inputsKey(path, now.activePath, now.fallback),
        root: path,
      });
      if (!canUseWindows) setUiState("openFolder", path);
      void session.addRecentFolder(path).catch(() => {});
      const agentRoot = agentRootOnOpen(
        now.settings.agentWorkspaceRoot,
        agentRootFromFolder(),
        path,
      );
      if (agentRoot !== null) {
        now.setSettings({ agentWorkspaceRoot: agentRoot });
        setUiState("agentRootFromFolder", agentRoot);
      }
      onOpened();
    },
    [onOpened],
  );

  const closeFolder = useCallback(() => {
    const now = latest.current;
    if (!now.folder) return;
    const agentRoot = agentRootOnClose(
      now.settings.agentWorkspaceRoot,
      agentRootFromFolder(),
      now.folder,
    );
    if (agentRoot !== null) {
      now.setSettings({ agentWorkspaceRoot: agentRoot });
      setUiState("agentRootFromFolder", "");
    }
    setFolder(null);
    // Back to following the document.
    setTree({
      key: inputsKey(null, now.activePath, now.fallback),
      root: now.activePath ? dirname(now.activePath) : now.fallback,
    });
    if (!canUseWindows) setUiState("openFolder", null);
  }, []);

  const openFolderDialog = useCallback(async () => {
    try {
      const picked = await fs.pickOpenFolder();
      if (picked) openFolder(picked);
    } catch (err) {
      if (isError(err, "tooBroad")) void showMessage(folderTooBroad);
    }
  }, [openFolder, folderTooBroad]);

  // A recent folder chosen while no window was open (this window was
  // opened to show it), else the folder its session had open. Taken once.
  const open = useLatest(openFolder);
  useEffect(() => {
    void Promise.all([
      windowIpc.takePendingOpenFolder().catch(() => null),
      canUseWindows ? takeWindowSession() : null,
    ]).then(([pending, window]) => {
      const path =
        pending ?? (window ? (window.folder ?? olderFolder()) : null);
      if (path) open.current(path);
    });
  }, [open]);

  return {
    folder,
    treeRoot,
    setTreeRoot,
    revealed,
    openFolder,
    openFolderDialog,
    closeFolder,
  };
}

export type OpenFolder = ReturnType<typeof useOpenFolder>;
