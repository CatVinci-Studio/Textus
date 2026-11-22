import { onMemoryIdle } from "../utils/memory-idle";
import { fs } from "../platform/ipc";

type FolderIndex = Awaited<ReturnType<typeof fs.indexFolder>>;

/** An index older than this is read again on the next ask. */
const FRESH_MS = 10_000;

let last: { root: string; at: number; index: Promise<FolderIndex> } | null =
  null;
onMemoryIdle(() => (last = null));

/**
 * The folder's files for the editor's completions (`[[`, a link's path): one
 * walk however many lists ask while it is fresh, the same object each time,
 * so what is built from it can be kept with it.
 */
export function folderIndex(root: string): Promise<FolderIndex> {
  if (!last || last.root !== root || Date.now() - last.at > FRESH_MS) {
    const index = fs.indexFolder(root);
    last = { root, at: Date.now(), index };
    // A refusal (too broad, gone) is asked again next time, not kept.
    index.catch(() => {
      if (last?.index === index) last = null;
    });
  }
  return last.index;
}
