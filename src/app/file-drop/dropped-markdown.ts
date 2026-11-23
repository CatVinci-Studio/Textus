import type { FileDropTarget } from "../../engine/controls/document-drop";
import { fs } from "../../platform/ipc";
import { basename, dirname } from "../../utils/path";
import { announceFileCreated } from "../../utils/events";
import { linkSource } from "../../editor/markdown/link-syntax";
import { linkStyleAt } from "../../files/link-style";
import { pathIndex } from "../../files/link-resolve";
import { fileLinkSource } from "../../files/link-to-file";
import { provideDrop } from "../../plugins/contributions/drop-handlers";
import type { FileKind } from "./drop-route";

/** A link to a file from a file manager, once copied beside the document. */
async function copiedFileLink(path: string, target: FileDropTarget) {
  if (!target.docPath) return null;
  const saved = await fs.saveDroppedFile(
    target.docPath,
    path,
    target.imageFolder,
  );
  if (saved.path) announceFileCreated(saved.path);
  return saved.embed ?? linkSource(basename(path), saved.src);
}

/**
 * What a file dropped into the document `target` becomes: a plugin's
 * Markdown for it, else a picture or a link - to it where it is in the
 * folder (`root`: where the folder's links resolve), or to a copy of it
 * beside the document when it came from a file manager. Null: nothing.
 */
export async function droppedMarkdown(
  file: { path: string; kind: FileKind; fromSystem: boolean },
  target: FileDropTarget,
  root: string | null,
): Promise<string | null> {
  const { path, kind, fromSystem } = file;
  if (kind === "folder") return null;
  const own = await provideDrop({
    path,
    name: basename(path),
    kind,
    fromSystem,
    document: target.docPath,
  });
  if (own !== null) return own;
  if (fromSystem)
    return kind === "image"
      ? target.storeImage(path)
      : copiedFileLink(path, target);
  const from = target.docPath;
  if (!from) return null;
  const style = await linkStyleAt(from);
  const paths = pathIndex(root ?? dirname(from), [path, from]);
  return fileLinkSource(paths, path, from, style);
}
