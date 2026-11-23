import { farFiles, farRelative } from "./far-files";
import { command } from "./ipc-call";
import { scopedFolder } from "./scoped-folder";
import type { DocumentMeta_Serialize } from "./bindings/plugin-access";
import { basename, contentJoin, isWithin, parentDir } from "../utils/path";
import { ownError } from "../utils/error-text";

/**
 * A plugin's file calls in a folder the backend can't walk (far-files.ts):
 * an Android pick, read through the native plugin, or a plugin's remote
 * folder. The paths are checked here as Rust checks them on disk: inside
 * the folder, never climbing out. An Android file's URL is its folder's
 * document id and its own path below it, as the folder's listing spells
 * them; a remote one is a plain URL path.
 */

interface ContentEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_ms: number | null;
}

/** The URL of `path` (relative to `root`, or a URL inside it). */
export function contentPath(root: string, path: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    if (!isWithin(path, root))
      throw new Error(`${path} is outside the folder.`);
    return path;
  }
  const parts = path.split(/[\\/]/);
  if (parts.some((p) => p === ".."))
    throw new Error(`${path} is outside the folder.`);
  if (!root.startsWith("content://")) {
    const kept = parts.filter((p) => p !== "" && p !== ".");
    return kept.length ? `${root.replace(/\/+$/, "")}/${kept.join("/")}` : root;
  }
  if (!root.includes("/document/"))
    throw new Error(`${root} isn't a folder's URL.`);
  return contentJoin(root, path);
}

const entryOf = (e: {
  name: string;
  path: string;
  is_dir: boolean;
}): ContentEntry => ({
  name: e.name,
  path: e.path,
  is_dir: e.is_dir,
  size: 0,
  modified_ms: null,
});

async function stat(root: string, path: string): Promise<ContentEntry | null> {
  const url = contentPath(root, path);
  if (url === root) return entryOf({ name: "", path: root, is_dir: true });
  const parent = parentDir(url);
  if (!parent) return null;
  const listed = await farFiles(parent)
    .listFolder(parent)
    .catch(() => []);
  const found = listed.find((e) => e.path === url);
  return found ? entryOf(found) : null;
}

/** The folder at `url`, made with the ones above it as needed. */
async function folder(root: string, url: string): Promise<string> {
  if (url === root) return url;
  const here = await stat(root, url);
  if (here?.is_dir) return url;
  if (here) throw new Error(`${basename(url)} is a file.`);
  const parent = parentDir(url);
  if (!parent || !isWithin(parent, root))
    throw new Error(`${url} is outside the folder.`);
  return farFiles(url).createEntry(
    await folder(root, parent),
    basename(url),
    true,
  );
}

/** A new file at `url`, its folders made first. */
async function newFile(root: string, url: string): Promise<string> {
  const parent = parentDir(url);
  if (!parent) throw new Error(`${url} is outside the folder.`);
  return farFiles(url).createEntry(
    await folder(root, parent),
    basename(url),
    false,
  );
}

async function tokenOf(text: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const bytesOf = (base64: string) =>
  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/** The folder's documents' metadata as last read, kept until a file is
 *  written here or the window comes back from another app. */
let known: {
  root: string;
  stale: boolean;
  generation: number;
  texts: Map<string, string>;
  documents: DocumentMeta_Serialize[];
} | null = null;

/** Something here may have changed: read again when next asked. */
export function contentFolderChanged(): void {
  if (known) known.stale = true;
}
let listening = false;

const parse = (
  documents: { path: string; rel: string; text: string }[],
  blocks: boolean,
) =>
  command(
    "plugin_metadata_of_texts",
    documents.map(({ path, rel, text }) => ({ path, rel, text })),
    blocks,
  );

/** As the backend's metadata.all: every document, whole when they changed
 *  since `after`, nothing when they didn't. */
async function metadataAll(root: string, after: number | null) {
  if (!listening) {
    listening = true;
    window.addEventListener("focus", contentFolderChanged);
  }
  if (!(known?.root === root && !known.stale)) {
    const { documents } = await scopedFolder.documents(root);
    const texts = new Map(documents.map((d) => [d.path, d.text]));
    const was = known?.root === root ? known : null;
    const same =
      was?.texts.size === texts.size &&
      [...texts].every(([path, text]) => was.texts.get(path) === text);
    if (same) was.stale = false;
    else
      known = {
        root,
        stale: false,
        generation: (was?.generation ?? 0) + 1,
        texts,
        documents: await parse(documents, false),
      };
  }
  const { generation, documents } = known!;
  return after === generation
    ? { generation, whole: false, documents: [], gone: [] }
    : { generation, whole: true, documents, gone: [] };
}

/** `run`, which writes here: the folder's documents read again when next
 *  asked. */
function written<A extends unknown[], T>(
  run: (...args: A) => Promise<T>,
): (...args: A) => Promise<T> {
  return (...args) => run(...args).finally(contentFolderChanged);
}

export const farPluginFs = {
  /** A file the user picked: its URL is its grant, no folder around it. */
  readResource: async (url: string) =>
    bytesOf(await farFiles(url).readBase64(url)),
  writeResource: (url: string, text: string) =>
    farFiles(url).writeText(url, text),
  read: async (root: string, path: string) => {
    const url = contentPath(root, path);
    return bytesOf(await farFiles(url).readBase64(url));
  },
  list: async (root: string, path: string) => {
    const url = contentPath(root, path);
    return (await farFiles(url).listFolder(url)).map(entryOf);
  },
  stat,
  readVersioned: async (root: string, path: string) => {
    const url = contentPath(root, path);
    const text = await farFiles(url).readText(url);
    return { text, token: await tokenOf(text) };
  },
  writeIf: written(
    async (root: string, path: string, text: string, token: string) => {
      const url = contentPath(root, path);
      const now = await farFiles(url).readText(url);
      if ((await tokenOf(now)) !== token) return false;
      await farFiles(url).writeText(url, text);
      return true;
    },
  ),
  write: written(
    async (root: string, path: string, text: string, base64: boolean) => {
      if (base64)
        throw new Error(
          "Files other than text can't be written in this folder.",
        );
      const url = contentPath(root, path);
      const at = (await stat(root, url)) ? url : await newFile(root, url);
      await farFiles(at).writeText(at, text);
    },
  ),
  create: written(async (root: string, path: string, text: string) => {
    const url = contentPath(root, path);
    if (await stat(root, url)) throw new Error(`${path} already exists.`);
    const made = await newFile(root, url);
    await farFiles(made).writeText(made, text);
  }),
  mkdir: written(async (root: string, path: string) => {
    await folder(root, contentPath(root, path));
  }),
  rename: written(async (root: string, from: string, to: string) => {
    const source = contentPath(root, from);
    const target = contentPath(root, to);
    if (!(await stat(root, source))) throw new Error(`No file ${from}.`);
    if (await stat(root, target)) throw new Error(`${to} already exists.`);
    const was = parentDir(source)!;
    const into = parentDir(target);
    if (!into) throw new Error(`${to} is outside the folder.`);
    let url = source;
    if (into !== was)
      url = await farFiles(source).moveEntry(
        source,
        was,
        await folder(root, into),
      );
    if (basename(url) !== basename(target))
      await farFiles(url).renameEntry(url, basename(target));
  }),
  documents: (root: string) => scopedFolder.documents(root),
  search: async (root: string, query: string, limit: number | null) => {
    const found = await scopedFolder.search(root, query);
    return limit === null || found.hits.length <= limit
      ? found
      : { hits: found.hits.slice(0, limit), truncated: true };
  },
  metadataAll,
  metadataGet: async (root: string, path: string) => {
    const url = contentPath(root, path);
    const text = await farFiles(url)
      .readText(url)
      .catch(() => null);
    if (text === null) return null;
    const rel = farRelative(root, url);
    const [meta] = await parse([{ path: url, rel, text }], true);
    return meta ?? null;
  },
  /** Such a folder has no Trash, and nothing a plugin removes is gone for
   *  good: it is left to the Files app. */
  trash: async (): Promise<never> => {
    throw new Error(ownError("noTrash"));
  },
};
