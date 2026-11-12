import { linkStyleAt } from "../../files/link-style";
import { linkToTarget, pathIndex } from "../../files/link-resolve";
import { dirname } from "../../utils/path";
import { INSERT_MARKDOWN_EVENT } from "../../utils/events";

/** A link to `path` put in at the caret of the document `from`, written
 *  as links there are (standard with %20, or wiki in a vault that uses
 *  them); `root` is the folder links resolve in. */
export async function linkToFile(
  path: string,
  from: string,
  root: string | null,
): Promise<void> {
  const style = await linkStyleAt(from);
  const paths = pathIndex(root ?? dirname(from), [path, from]);
  window.dispatchEvent(
    new CustomEvent(INSERT_MARKDOWN_EVENT, {
      detail: linkToTarget(paths, path, from, style),
    }),
  );
}
