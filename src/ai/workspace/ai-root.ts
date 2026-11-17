import { useSyncExternalStore } from "react";
import { createSubscribers } from "../../utils/store";

/**
 * The AI's project folder in this window, worked out in one place: the one
 * the user picked for it (Settings, the chat's project bar), else the
 * folder open in this window's sidebar. Nothing copies one into the other.
 * An Android folder opened without access to all files (content://) is
 * none: the AI's tools read the disk.
 */

let open: string | null = null;
const changed = createSubscribers();

/** This window's open folder, as the sidebar has it (useOpenFolder). */
export function setOpenFolder(path: string | null): void {
  if (path === open) return;
  open = path;
  changed.publish();
}

const usable = (folder: string | null) =>
  folder && !folder.startsWith("content://") ? folder : null;

/** The AI's folder now, read as a call starts. */
export function aiRoot(settings: {
  agentWorkspaceRoot: string;
}): string | null {
  return settings.agentWorkspaceRoot || usable(open);
}

/** {@link aiRoot}, drawn again when the open folder changes. */
export function useAiRoot(settings: {
  agentWorkspaceRoot: string;
}): string | null {
  const folder = useSyncExternalStore(changed.subscribe, () => open);
  return settings.agentWorkspaceRoot || usable(folder);
}
