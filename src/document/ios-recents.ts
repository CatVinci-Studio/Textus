import { isIOSApp } from "../platform/capabilities";
import {
  deleteSandboxEntry,
  renameSandboxEntry,
  documentsFolder,
  joinPath,
} from "../platform/ios-files";
// Entries in Documents are stored relative to it: the app's container moves
// on every reinstall and App Store update (see documents-path.ts).
import { IN_DOCUMENTS } from "../platform/documents-path";
import { getUiState, setUiState, uiStateReady } from "../storage/ui-state";

// The iPhone's recent-documents list, kept in ui-state.json: what reopens at
// launch, File > Open Recent and the document list. File access itself is
// platform/ios-files.ts.

/** The document list keeps this many; the phone menu shows the first few. */
const RECENT_LIMIT = 30;

/** The stored list (ui-state.json; see storage/ui-state.ts). Waits for the
 *  live copy: a reload replays the boot snapshot, and a read-modify-write
 *  built on that would drop whatever was opened since the window was made. */
async function readRecents(): Promise<string[]> {
  await uiStateReady();
  const list = getUiState("iosRecentDocuments");
  return Array.isArray(list)
    ? list.filter((p): p is string => typeof p === "string")
    : [];
}

/** The tail of the queue of changes to the list, see updateRecents. */
let recentsQueue: Promise<unknown> = Promise.resolve();

/**
 * Changes the stored list, one change at a time. Each is a read, an await
 * or two (the live copy, the Documents path), then a write - and two
 * documents opened together (a launch restoring one while "Open in Textus"
 * delivers another) used to interleave: both read the same list and the
 * second write dropped the first one's entry. Queued, each change starts
 * from what the previous one wrote.
 */
function updateRecents(
  change: (list: string[]) => string[] | Promise<string[]>,
): Promise<void> {
  const run = recentsQueue.then(async () => {
    const next = await change(await readRecents());
    setUiState("iosRecentDocuments", next.slice(0, RECENT_LIMIT));
  });
  // A failed change (Documents unavailable) must not stall the ones after.
  recentsQueue = run.catch(() => {});
  return run;
}

/** A stored entry as a path: Documents-relative ones resolved against
 *  `docs`, the app's current Documents folder. */
function resolveRecent(docs: string, stored: string): Promise<string> {
  return stored.startsWith(IN_DOCUMENTS)
    ? joinPath(docs, stored.slice(IN_DOCUMENTS.length))
    : Promise.resolve(stored);
}

/**
 * The documents opened most recently, newest first - File > Open Recent on
 * the phone, and the first is what reopens at launch: iOS ends a
 * backgrounded app whenever it likes, and the desktop's per-window session
 * (session.rs) and recents list (menu.rs) are not built there.
 */
export async function recentIOSDocuments(): Promise<string[]> {
  // After any change already queued, so it lists what that change made.
  await recentsQueue;
  const docs = await documentsFolder();
  return Promise.all(
    (await readRecents()).map((stored) => resolveRecent(docs, stored)),
  );
}

export async function lastIOSDocument(): Promise<string | null> {
  return (await recentIOSDocuments())[0] ?? null;
}

export async function rememberIOSDocument(path: string | null): Promise<void> {
  // Only ever added to, never cleared: the blank tab every launch starts
  // with would otherwise wipe it before startup gets to read it.
  if (!isIOSApp || !path) return;
  return updateRecents(async (list) => {
    const docs = (await documentsFolder()).replace(/\/+$/, "") + "/";
    const stored = path.startsWith(docs)
      ? IN_DOCUMENTS + path.slice(docs.length)
      : path;
    return [stored, ...list.filter((p) => p !== stored)];
  });
}

/** Drops an entry that no longer opens (moved or deleted in Files). */
export function forgetIOSDocument(path: string): Promise<void> {
  return updateRecents(async (list) => {
    const docs = await documentsFolder();
    const resolved = await Promise.all(
      list.map((stored) => resolveRecent(docs, stored)),
    );
    return list.filter((_, i) => resolved[i] !== path);
  });
}

/** Where a recent document lives: in the app's own Documents folder (which
 *  the list can rename and delete in), or picked from elsewhere in Files
 *  (iCloud Drive and the like - a single picked file grants access to that
 *  file only, not to its folder, so it can be opened and shared but not
 *  renamed or deleted from here). */
export async function inIOSDocuments(path: string): Promise<boolean> {
  const docs = (await documentsFolder()).replace(/\/+$/, "") + "/";
  return path.startsWith(docs);
}

/** Renames a document in Documents and keeps the recent list pointing at
 *  it. Returns the new path. */
export async function renameIOSDocument(
  path: string,
  name: string,
): Promise<string> {
  const renamed = await renameSandboxEntry(path, name);
  const docs = (await documentsFolder()).replace(/\/+$/, "") + "/";
  const before = IN_DOCUMENTS + path.slice(docs.length);
  const after = IN_DOCUMENTS + renamed.slice(docs.length);
  await updateRecents((list) => list.map((p) => (p === before ? after : p)));
  return renamed;
}

/** Deletes a document in Documents and drops it from the recent list. */
export async function deleteIOSDocument(path: string): Promise<void> {
  await deleteSandboxEntry(path);
  await forgetIOSDocument(path);
}
