import { showNotice } from "../../engine/controls/notices";
import { currentStrings } from "../../i18n/current";
import { isScopedUrl } from "../../platform/ios-files";
import { ownError } from "../../utils/error-text";

/** Folders the window already said this of. */
const told = new Set<string>();

/**
 * `root`, the folder a plugin's file call is for, when the backend can read
 * it. A folder Android opened without access to all files is a content://
 * tree only the window reads: the call is refused, and the window says once
 * why and how to give that access, rather than plugins finding it empty.
 */
export function readableRoot(root: string): string {
  if (!isScopedUrl(root)) return root;
  if (!told.has(root)) {
    told.add(root);
    showNotice(currentStrings().errorPluginsNeedAllFiles, { tone: "warning" });
  }
  throw new Error(ownError("pluginsNeedAllFiles"));
}
