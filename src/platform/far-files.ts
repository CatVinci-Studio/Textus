import type { DirEntryInfo } from "./bindings/files";
import { nativeFiles, isScopedUrl } from "./native-files";
import { isIOSApp } from "./capabilities";
import { basename, contentRelative } from "../utils/path";

/**
 * Folders the backend can't walk, read and written here instead: a phone's
 * Files-app picks (the native plugin) and a plugin's own kind of path
 * (`files.registerProvider`, `ssh://host/…`). One shape for both, so every
 * place that reads a folder asks this, not which kind it is.
 */

export interface FarFiles {
  listFolder(url: string): Promise<DirEntryInfo[]>;
  readText(url: string): Promise<string>;
  readBase64(url: string): Promise<string>;
  writeText(url: string, text: string): Promise<void>;
  /** The new entry's URL; a taken name is refused. */
  createEntry(folder: string, name: string, isFolder: boolean): Promise<string>;
  renameEntry(url: string, name: string): Promise<string>;
  moveEntry(url: string, from: string, into: string): Promise<string>;
  deleteEntry(url: string): Promise<unknown>;
}

/** Each plugin provider's files, by its scheme. */
const providers = new Map<string, FarFiles>();

const schemeOf = (path: string) =>
  /^([a-z][a-z0-9+.-]*):\/\//i.exec(path)?.[1]?.toLowerCase();

const providerOf = (path: string): FarFiles | undefined => {
  const scheme = schemeOf(path);
  return scheme ? providers.get(scheme) : undefined;
};

/** A plugin's paths under `scheme`, or (null) no longer. */
export function setFarProvider(scheme: string, files: FarFiles | null): void {
  if (files) providers.set(scheme.toLowerCase(), files);
  else providers.delete(scheme.toLowerCase());
}

/** Whether `path` is read here rather than by the backend. */
export const isFarUrl = (path: string): boolean =>
  isScopedUrl(path) || providerOf(path) !== undefined;

/** Schemes that are never a plugin's. */
export const RESERVED_SCHEMES: readonly string[] = [
  "file",
  "content",
  "http",
  "https",
  "data",
  "blob",
  "asset",
  "tauri",
  "textus",
  "mailto",
];

/** Whether `path` is a plugin's, its provider gone or not: never one for
 *  the backend, which would take it for a relative path. */
export const isProviderUrl = (path: string): boolean => {
  const scheme = schemeOf(path);
  return !!scheme && !RESERVED_SCHEMES.includes(scheme);
};

/** How `path` is read: its provider's, or the native plugin's. */
export const farFiles = (path: string): FarFiles =>
  providerOf(path) ?? nativeFiles;

/** Where a folder's entries are made, renamed, moved and deleted here: an
 *  Android pick or a provider's path; null for the backend's (an iOS pick
 *  is a plain path once opened). */
export function farEntries(path: string): FarFiles | null {
  const provider = providerOf(path);
  if (provider) return provider;
  return isScopedUrl(path) && !isIOSApp ? nativeFiles : null;
}

/** `url` as a path below the far folder `root` ("inbox/a.md"); its name
 *  when it isn't below it. */
export function farRelative(root: string, url: string): string {
  if (root.startsWith("content://"))
    return contentRelative(root, url) ?? basename(url);
  const base = root.replace(/\/+$/, "");
  return url.startsWith(`${base}/`)
    ? url.slice(base.length + 1)
    : basename(url);
}
