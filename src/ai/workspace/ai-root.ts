import { useSyncExternalStore } from "react";
import {
  onOpenFolderChange,
  openFolderOnDisk,
} from "../../platform/open-folder";
import { isFarUrl } from "../../platform/far-files";

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

/** The document and folder a call on a document's text reads its project
 *  from (conventions, library names). A document read through a plugin
 *  or another app's storage has no path the backend could open. */
export function aiProject(
  docPath: string | null,
  settings: { agentWorkspaceRoot: string },
): { docPath: string | null; workspaceRoot: string | null } {
  return {
    docPath: docPath && !isFarUrl(docPath) ? docPath : null,
    workspaceRoot: aiRoot(settings),
  };
}

/** {@link aiRoot}, drawn again when the open folder changes. */
export function useAiRoot(settings: {
  agentWorkspaceRoot: string;
}): string | null {
  const folder = useSyncExternalStore(onOpenFolderChange, openFolderOnDisk);
  return settings.agentWorkspaceRoot || folder;
}
