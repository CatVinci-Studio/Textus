import type {
  FolderIndex,
  IndexedFile,
  SearchHit,
  SearchResult,
  WorkspaceDocuments,
} from "./bindings/files";
import { iosFiles } from "./ios-files";

/*
 * A folder Android granted (a content:// tree) has no path the backend can
 * walk: its index, text search and documents are read here, through the
 * native plugin, with the backend's limits and result shapes.
 */

const MAX_FILES = 5000;
const MAX_HITS = 200;
const MAX_DOCUMENTS = 2000;
const DOCUMENT = /\.(md|markdown|mdx|txt)$/i;

async function walk(root: string): Promise<FolderIndex> {
  const files: IndexedFile[] = [];
  const queue: { url: string; rel: string }[] = [{ url: root, rel: "" }];
  while (queue.length && files.length < MAX_FILES) {
    const dir = queue.shift()!;
    const entries = await iosFiles.listFolder(dir.url).catch(() => []);
    for (const entry of entries) {
      if (entry.hidden) continue;
      const rel = dir.rel ? `${dir.rel}/${entry.name}` : entry.name;
      if (entry.is_dir) queue.push({ url: entry.path, rel });
      else files.push({ path: entry.path, rel });
    }
  }
  return { files, truncated: queue.length > 0 || files.length >= MAX_FILES };
}

/** Its Markdown documents with their text, up to `limit`. */
async function documents(root: string, limit: number) {
  const index = await walk(root);
  const docs = index.files.filter((f) => DOCUMENT.test(f.rel));
  const read = await Promise.all(
    docs.slice(0, limit).map(async (f) => ({
      ...f,
      text: await iosFiles.readText(f.path).catch(() => ""),
    })),
  );
  return { read, truncated: index.truncated || docs.length > limit };
}

export const scopedFolder = {
  index: walk,
  async search(root: string, query: string): Promise<SearchResult> {
    const needle = query.toLowerCase();
    const { read, truncated } = await documents(root, MAX_DOCUMENTS);
    const hits: SearchHit[] = [];
    for (const doc of read) {
      doc.text.split("\n").forEach((text, i) => {
        if (hits.length < MAX_HITS && text.toLowerCase().includes(needle))
          hits.push({ path: doc.path, rel: doc.rel, line: i + 1, text });
      });
    }
    return { hits, truncated: truncated || hits.length >= MAX_HITS };
  },
  async documents(root: string): Promise<WorkspaceDocuments> {
    const { read, truncated } = await documents(root, MAX_DOCUMENTS);
    return { documents: read, truncated };
  },
};
