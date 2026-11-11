import { grants } from "./api-permissions";
import { isInside, slashed } from "../utils/path";
import { webviewsOf } from "./views/webviews";

/** Whether plugin `id`, holding `granted`, may open `path`: a file its own
 *  view shows, or one of the open folder (`root`) with files.read - never
 *  one elsewhere on the disk. The one rule for every way a plugin opens. */
export function mayOpen(
  id: string,
  granted: readonly string[],
  root: string | null,
  path: string,
): boolean {
  if (webviewsOf(id).some((view) => view.resource === path)) return true;
  return (
    grants(granted, "files.read") &&
    !!root &&
    (path === root || inOpenFolder(root, path))
  );
}

/** Whether `path` is one of the open folder's own files a plugin may reach:
 *  under `root`, and in nothing hidden there but the folder's .textus -
 *  the backend's rule (access.rs in_folder), for what the window hands out
 *  itself (an open tab, a file opened in a plugin's editor). */
export function inOpenFolder(root: string, path: string): boolean {
  if (!isInside(path, root)) return false;
  const rel = slashed(path).slice(slashed(root).replace(/\/$/, "").length + 1);
  return !rel
    .split("/")
    .some(
      (part, i) => part.startsWith(".") && !(i === 0 && part === ".textus"),
    );
}
