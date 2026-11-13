import { documentDir } from "@tauri-apps/api/path";

/**
 * iOS Documents paths as stored between launches. The app container moves on
 * every reinstall and update, so they are stored as "documents:<rest>" and
 * resolved against the current folder. Desktop paths are stored as they are.
 */
export const IN_DOCUMENTS = "documents:";

const withSlash = (dir: string) => dir.replace(/\/+$/, "") + "/";

/** /private/var and /var are one place; iOS spells it either way. */
const unprivate = (p: string) => p.replace(/^\/private(?=\/var\/)/, "");

/** `path` relative to this install's Documents folder `docs`, however
 *  either is spelled; null outside it. */
export function insideDocuments(path: string, docs: string): string | null {
  const dir = unprivate(withSlash(docs));
  const bare = unprivate(path);
  return bare.startsWith(dir) ? bare.slice(dir.length) : null;
}

/**
 * `path` as stored: relative inside this install's Documents folder `docs`;
 * unchanged otherwise (another app's folder included) and while `docs`
 * isn't known.
 */
export function storedDocumentPath(path: string, docs: string | null): string {
  if (path.startsWith(IN_DOCUMENTS)) return path;
  // Not known yet: kept as it is, rather than guess whose container it is.
  const inside = docs ? insideDocuments(path, docs) : null;
  return inside === null ? path : IN_DOCUMENTS + inside;
}

/** A stored path resolved into the current Documents folder `docs`. */
export function resolvedDocumentPath(stored: string, docs: string): string {
  return stored.startsWith(IN_DOCUMENTS)
    ? withSlash(docs) + stored.slice(IN_DOCUMENTS.length)
    : stored;
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
