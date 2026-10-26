import { documentDir } from "@tauri-apps/api/path";

/**
 * iOS Documents paths as stored between launches. The app container moves on
 * every reinstall and update, so they are stored as "documents:<rest>" and
 * resolved against the current folder. Desktop paths are stored as they are.
 */
export const IN_DOCUMENTS = "documents:";

/** An app container's Documents folder in an absolute path, this install's
 *  or an earlier one's. Files-app picks are `file://` URLs and don't match. */
const CONTAINER_DOCUMENTS =
  /^\/.*\/Containers\/Data\/Application\/[0-9A-Fa-f-]+\/Documents\/(.+)$/;

const withSlash = (dir: string) => dir.replace(/\/+$/, "") + "/";

/**
 * `path` as stored: relative when inside the current or any container's
 * Documents folder, unchanged otherwise.
 */
export function storedDocumentPath(path: string, docs: string | null): string {
  if (path.startsWith(IN_DOCUMENTS)) return path;
  if (docs && path.startsWith(withSlash(docs)))
    return IN_DOCUMENTS + path.slice(withSlash(docs).length);
  const match = CONTAINER_DOCUMENTS.exec(path);
  return match ? IN_DOCUMENTS + match[1] : path;
}

/** A stored path resolved into the current Documents folder `docs`. */
export function resolvedDocumentPath(stored: string, docs: string): string {
  const inside = stored.startsWith(IN_DOCUMENTS)
    ? stored.slice(IN_DOCUMENTS.length)
    : CONTAINER_DOCUMENTS.exec(stored)?.[1];
  return inside === undefined ? stored : withSlash(docs) + inside;
}

let known: string | null = null;
let loading: Promise<string> | null = null;

/** The app's Documents folder, with a trailing slash. Asked of Tauri once. */
export function documentsDir(): Promise<string> {
  loading ??= documentDir().then(
    (dir) => (known = withSlash(dir)),
    (err: unknown) => {
      loading = null;
      throw err;
    },
  );
  return loading;
}

/** The Documents folder if documentsDir has answered already, else null. */
export function knownDocumentsDir(): string | null {
  return known;
}
