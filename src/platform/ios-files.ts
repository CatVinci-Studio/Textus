import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { type DirEntryInfo } from "./bindings/files";
import { isIOSApp, isMobileApp } from "./capabilities";
import { nameContentUrl } from "../utils/path";
import { documentsDir, insideDocuments } from "./documents-path";

/**
 * iOS and Android document access. Files-app picks are `file://` URLs read
 * through the native plugin, which holds the security scope; Android's are
 * `content://` URLs read through its ContentResolver. The app's own
 * Documents folder keeps plain paths and the ordinary Rust commands.
 */

/** True for a picked file or folder (a URL) rather than a sandbox path. */
export function isScopedUrl(path: string): boolean {
  return isIOSApp
    ? path.startsWith("file://")
    : isMobileApp && path.startsWith("content://");
}

type Picked = { url: string | null; name?: string; folder?: boolean };

/** A pick or a listing's item, its name kept for a content:// URL. */
function named<T extends { url: string | null; name?: string }>(item: T): T {
  if (item.url?.startsWith("content://") && item.name)
    nameContentUrl(item.url, item.name);
  return item;
}

const call = <T>(command: string, args?: Record<string, unknown>) =>
  invoke<T>(`plugin:textus-files|${command}`, args ? { args } : undefined);

/** A pick from the app's own Documents folder as its plain path, or the
 *  same file opens twice, once per spelling. */
async function inDocuments(url: string | null): Promise<string | null> {
  if (!url?.startsWith("file://")) return url;
  const docs = await documentsDir();
  const inside = insideDocuments(
    decodeURIComponent(new URL(url).pathname),
    docs,
  );
  return inside === null ? url : docs + inside;
}

export const iosFiles = {
  /** The Files app's document picker; null when cancelled. */
  pickDocument: async (): Promise<string | null> =>
    inDocuments(named(await call<Picked>("pick_document")).url),
  /** Android's Save As for a new document: where and under what name, in
   *  the system's picker; null when cancelled. */
  createDocument: async (name: string): Promise<string | null> =>
    named(await call<Picked>("create_document", { name })).url,
  readText: async (url: string): Promise<string> =>
    (await call<{ text: string }>("read_text", { url })).text,
  /** A tap felt under the finger, as something lifts. Never fails. */
  haptic: (): void => void call<void>("haptic").catch(() => {}),
  /** The share sheet for a saved document, by path or picked URL. */
  share: (path: string): Promise<void> => call<void>("share", { path }),
  readBase64: async (url: string): Promise<string> =>
    (await call<{ data: string }>("read_data", { url })).data,
  writeText: (url: string, text: string): Promise<void> =>
    call<void>("write_text", { url, text }),
  listFolder: async (url: string): Promise<DirEntryInfo[]> =>
    (
      await call<{
        entries: { url: string; name: string; folder: boolean }[];
      }>("list_folder", { url })
    ).entries
      .map(named)
      .map((e) => ({
        name: e.name,
        path: e.url,
        is_dir: e.folder,
        hidden: e.name.startsWith("."),
        ignored: false,
      })),
  /** Picked files and folders that survive a relaunch. */
  remembered: async () =>
    (
      await call<{ items: { url: string; name: string; folder: boolean }[] }>(
        "remembered",
      )
    ).items,
  /** Opens a picked folder for the session and returns its plain path. */
  beginAccess: async (url: string): Promise<string> =>
    (await call<{ path: string }>("begin_access", { url })).path,
  /** Picks a folder for the project and opens it: its plain path, or null. */
  pickProjectFolder: async (): Promise<string | null> => {
    const url = named(await call<Picked>("pick_folder")).url;
    return url ? iosFiles.beginAccess(url) : null;
  },
};

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  heic: "image/heic",
};

/**
 * An image a picked document refers to, as a data: URL read by the plugin.
 * Works only inside a picked folder: a lone picked file grants just itself.
 */
export async function scopedImageSrc(
  src: string,
  docUrl: string,
): Promise<string> {
  const url = new URL(src, docUrl).href;
  const ext = url.split(".").pop()?.toLowerCase() ?? "";
  const type = IMAGE_TYPES[ext] ?? "application/octet-stream";
  return `data:${type};base64,${await iosFiles.readBase64(url)}`;
}

/**
 * Reopens folders picked in earlier sessions: an iOS scope ends with the
 * process, so the AI couldn't read the project after a relaunch otherwise.
 */
export async function restoreFolderAccess(): Promise<void> {
  if (!isMobileApp) return;
  const { items } = await call<{
    items: { url: string; name: string; folder: boolean }[];
  }>("remembered");
  // Android: the names of documents reopened from the last session.
  items.forEach(named);
  if (!isIOSApp) return;
  await Promise.all(
    items
      .filter((item) => item.folder)
      .map((item) => iosFiles.beginAccess(item.url).catch(() => null)),
  );
}

/** The app's Documents folder ("On My iPhone > Textus"); null until it
 *  resolves, and always on desktop. */
export function useIOSDocumentsFolder(): string | null {
  const [dir, setDir] = useState<string | null>(null);
  useEffect(() => {
    if (!isIOSApp) return;
    let alive = true;
    void documentsDir().then((path) => alive && setDir(path.slice(0, -1)));
    return () => {
      alive = false;
    };
  }, []);
  return dir;
}

/**
 * Where "Save" puts a new document on iOS, with no save panel to ask: the
 * Documents folder, numbered ("Notes 2.md") rather than overwriting.
 */
export async function newDocumentPath(
  defaultName: string,
  exists: (path: string) => Promise<boolean>,
): Promise<string> {
  const dir = await documentsDir();
  const dot = defaultName.lastIndexOf(".");
  const stem = dot > 0 ? defaultName.slice(0, dot) : defaultName;
  const ext = dot > 0 ? defaultName.slice(dot) : ".md";
  for (let n = 1; ; n++) {
    const path = await join(
      dir,
      n === 1 ? `${stem}${ext}` : `${stem} ${n}${ext}`,
    );
    if (!(await exists(path))) return path;
  }
}

/** Renames a file in the app's own Documents folder; the new path. */
export function renameSandboxEntry(
  path: string,
  name: string,
): Promise<string> {
  return invoke<string>("rename_entry", { path, name });
}

/** Deletes a file or folder in the app's own Documents folder. */
export function deleteSandboxEntry(path: string): Promise<void> {
  return invoke("delete_entry", { path });
}
