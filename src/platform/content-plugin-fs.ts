import { iosFiles } from "./ios-files";
import { basename, contentJoin, isWithin, parentDir } from "../utils/path";

/**
 * A plugin's file calls in an Android folder opened without access to all
 * files: content:// URLs, read and written through the native plugin. The
 * paths are checked here as Rust checks them on disk: inside the folder,
 * never climbing out. A file's URL is its folder's document id and its own
 * path below it, as the folder's listing spells them.
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
  if (path.startsWith("content://")) {
    if (!isWithin(path, root))
      throw new Error(`${path} is outside the folder.`);
    return path;
  }
  if (path.split(/[\\/]/).some((p) => p === ".."))
    throw new Error(`${path} is outside the folder.`);
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
  const listed = await iosFiles.listFolder(parent).catch(() => []);
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
  return iosFiles.createEntry(await folder(root, parent), basename(url), true);
}

/** A new file at `url`, its folders made first. */
async function newFile(root: string, url: string): Promise<string> {
  const parent = parentDir(url);
  if (!parent) throw new Error(`${url} is outside the folder.`);
  return iosFiles.createEntry(await folder(root, parent), basename(url), false);
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

export const contentPluginFs = {
  /** A file the user picked: its URL is its grant, no folder around it. */
  readResource: async (url: string) => bytesOf(await iosFiles.readBase64(url)),
  writeResource: (url: string, text: string) => iosFiles.writeText(url, text),
  read: async (root: string, path: string) =>
    bytesOf(await iosFiles.readBase64(contentPath(root, path))),
  list: async (root: string, path: string) =>
    (await iosFiles.listFolder(contentPath(root, path))).map(entryOf),
  stat,
  readVersioned: async (root: string, path: string) => {
    const text = await iosFiles.readText(contentPath(root, path));
    return { text, token: await tokenOf(text) };
  },
  writeIf: async (root: string, path: string, text: string, token: string) => {
    const url = contentPath(root, path);
    const now = await iosFiles.readText(url);
    if ((await tokenOf(now)) !== token) return false;
    await iosFiles.writeText(url, text);
    return true;
  },
  write: async (root: string, path: string, text: string, base64: boolean) => {
    if (base64)
      throw new Error("Files other than text can't be written in this folder.");
    const url = contentPath(root, path);
    const at = (await stat(root, url)) ? url : await newFile(root, url);
    await iosFiles.writeText(at, text);
  },
  create: async (root: string, path: string, text: string) => {
    const url = contentPath(root, path);
    if (await stat(root, url)) throw new Error(`${path} already exists.`);
    await iosFiles.writeText(await newFile(root, url), text);
  },
  mkdir: async (root: string, path: string) => {
    await folder(root, contentPath(root, path));
  },
  rename: async (root: string, from: string, to: string) => {
    const source = contentPath(root, from);
    const target = contentPath(root, to);
    if (!(await stat(root, source))) throw new Error(`No file ${from}.`);
    if (await stat(root, target)) throw new Error(`${to} already exists.`);
    const was = parentDir(source)!;
    const into = parentDir(target);
    if (!into) throw new Error(`${to} is outside the folder.`);
    let url = source;
    if (into !== was)
      url = await iosFiles.moveEntry(source, was, await folder(root, into));
    if (basename(url) !== basename(target))
      await iosFiles.renameEntry(url, basename(target));
  },
  /** Such a folder has no Trash, and nothing a plugin removes is gone for
   *  good: it is left to the Files app. */
  trash: async (): Promise<never> => {
    throw new Error("This folder has no Trash: delete it in the Files app.");
  },
};
