import type { Strings } from "../i18n/strings";
import { isWithin } from "./tree-root";

/** Under the toolbar while no folder is open and the tree follows the
 *  document: says so, and offers to open the folder it shows as a folder,
 *  which Close Folder then closes. */
export function TreeFollowing({
  t,
  root,
  activePath,
  onOpenAsFolder,
}: {
  t: Strings;
  root: string;
  activePath: string | null;
  onOpenAsFolder: (path: string) => void;
}) {
  return (
    <div className="tree-following">
      {activePath && isWithin(activePath, root) && (
        <span className="tree-following-label">{t.treeDocumentFolder}</span>
      )}
      <button
        type="button"
        className="tree-following-open"
        onClick={() => onOpenAsFolder(root)}
      >
        {t.treeOpenAsFolder}
      </button>
    </div>
  );
}
