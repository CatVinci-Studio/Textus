import { createSubscribers } from "../utils/store";
import { isProviderUrl } from "./far-files";

/**
 * The folder open in this window's sidebar, as useOpenFolder sets it. An
 * Android folder opened without access to all files (content://) is not
 * one on disk: what reads the disk gets none.
 */

let open: string | null = null;
const changed = createSubscribers();

/** This window's open folder, as the sidebar has it (useOpenFolder). */
export function setOpenFolder(path: string | null): void {
  if (path === open) return;
  open = path;
  changed.publish();
}

/** This window's open folder on disk, if any. */
export const openFolderOnDisk = (): string | null =>
  open && !open.startsWith("content://") && !isProviderUrl(open) ? open : null;

/** Called as the open folder changes. */
export const onOpenFolderChange = changed.subscribe;

/** Calls `run` with each folder on disk opened in this window, as it opens. */
export const onOpenFolder = (run: (folder: string) => void) =>
  changed.subscribe(() => {
    const folder = openFolderOnDisk();
    if (folder) run(folder);
  });
