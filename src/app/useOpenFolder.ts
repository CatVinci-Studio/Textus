import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { canOpenFolder } from "../platform/capabilities";
import { fs, session, windowIpc } from "../platform/ipc";
import { getUiState, setUiState } from "../storage/ui-state";
import { useSettings } from "../settings/SettingsContext";
import { showMessage } from "../ui/app-dialog";
import { dirname } from "../utils/path";
import {
  agentRootOnClose,
  agentRootOnOpen,
  nextTreeRoot,
} from "../sidebar/tree-root";

/** The folder the last session had open, for the window that restores the
 *  session: the first one, "main" (lib.rs reopens every document of the
 *  last session there). A window opened later starts without one. */
function restoredFolder(restoreSession: boolean): string | null {
  if (!canOpenFolder || !restoreSession) return null;
  try {
    if (getCurrentWindow().label !== "main") return null;
  } catch {
    return null;
  }
  const saved = getUiState("openFolder");
  return typeof saved === "string" && saved ? saved : null;
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
 * The sidebar tree's root and the folder opened with File > Open Folder…,
 * for one window. The folder pins the tree's root and is what the file
 * search covers; without one the tree follows the document in front, but
 * only out of a folder it isn't in (sidebar/tree-root.ts). The folder is
 * remembered in ui-state and comes back with the session, and it is listed
 * under File > Open Recent.
 *
 * Opening a folder also makes it the AI's project folder, unless the user
 * chose a different one for the AI (agentRootOnOpen).
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
      setUiState("openFolder", path);
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
    // Back to following the document: its own folder, as before the folder
    // was opened.
    setTree({
      key: inputsKey(null, now.activePath, now.fallback),
      root: now.activePath ? dirname(now.activePath) : now.fallback,
    });
    setUiState("openFolder", null);
  }, []);

  const openFolderDialog = useCallback(async () => {
    try {
      const picked = await fs.pickOpenFolder();
      if (picked) openFolder(picked);
    } catch (err) {
      if (String(err).includes("TOO_BROAD")) void showMessage(folderTooBroad);
    }
  }, [openFolder, folderTooBroad]);

  // A recent folder chosen while no window was open: this window was
  // opened to show it (menu.rs). Asked once - the answer is taken.
  useEffect(() => {
    void windowIpc
      .takePendingOpenFolder()
      .then((path) => path && openFolder(path))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    folder,
    treeRoot,
    setTreeRoot,
    openFolder,
    openFolderDialog,
    closeFolder,
  };
}

export type OpenFolder = ReturnType<typeof useOpenFolder>;
