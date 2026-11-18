import { useSyncExternalStore } from "react";
import {
  onOpenFolderChange,
  openFolderOnDisk,
} from "../../platform/open-folder";

/**
 * The AI's project folder in this window, worked out in one place: the one
 * the user picked for it (Settings, the chat's project bar), else the
 * folder open in this window's sidebar on disk (open-folder.ts). Nothing
 * copies one into the other.
 */

/** The AI's folder now, read as a call starts. */
export function aiRoot(settings: {
  agentWorkspaceRoot: string;
}): string | null {
  return settings.agentWorkspaceRoot || openFolderOnDisk();
}

/** {@link aiRoot}, drawn again when the open folder changes. */
export function useAiRoot(settings: {
  agentWorkspaceRoot: string;
}): string | null {
  const folder = useSyncExternalStore(onOpenFolderChange, openFolderOnDisk);
  return settings.agentWorkspaceRoot || folder;
}
