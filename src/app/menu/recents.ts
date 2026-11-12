import { menuIpc } from "../../platform/ipc";
import type { RecentLists } from "../../registry/menu/app-menu-model";

/** The recent files and projects, most recent first. */
export async function readRecents(): Promise<RecentLists> {
  const [files, folders] = await Promise.all([
    menuIpc.listRecentFiles(),
    menuIpc.listRecentFolders(),
  ]);
  // The dev shim answers null rather than rejecting.
  return {
    files: Array.isArray(files) ? files : [],
    folders: Array.isArray(folders) ? folders : [],
  };
}
