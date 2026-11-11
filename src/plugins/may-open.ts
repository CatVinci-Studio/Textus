import { grants } from "./api-permissions";
import { isInside } from "../utils/path";
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
    (path === root || isInside(path, root))
  );
}
