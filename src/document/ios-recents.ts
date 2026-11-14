import { isMobileApp } from "../platform/capabilities";
import { deleteSandboxEntry, renameSandboxEntry } from "../platform/ios-files";
// Entries in Documents are stored relative to it: the app's container moves
// on every reinstall and App Store update.
import {
  IN_DOCUMENTS,
  documentsDir,
  resolvedDocumentPath,
  storedDocumentPath,
} from "../platform/documents-path";
import { getUiState, setUiState, uiStateReady } from "../storage/ui-state";

// The iPhone's recent-documents list: what reopens at launch, Open Recent
// and the document list.

/** The document list keeps this many; the phone menu shows the first few. */
const RECENT_LIMIT = 30;

/** The stored list. Waits for the live copy: a read-modify-write on the boot
 *  snapshot would drop what was opened since. */
async function readRecents(): Promise<string[]> {
  await uiStateReady();
  const list = getUiState("iosRecentDocuments");
  return Array.isArray(list)
    ? list.filter((p): p is string => typeof p === "string")
    : [];
}

let recentsQueue: Promise<unknown> = Promise.resolve();

/** Changes the stored list one change at a time, so two documents opened
 *  together can't both read the same list and drop an entry. */
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

/** The documents opened most recently, newest first; the first reopens at
 *  launch, since a phone ends a backgrounded app whenever it likes
 *  (Android's are content:// URLs, kept as they are). */
export async function recentIOSDocuments(): Promise<string[]> {
  // After any change already queued, so it lists what that change made.
  await recentsQueue;
  const docs = await documentsDir();
  return (await readRecents()).map((stored) =>
    resolvedDocumentPath(stored, docs),
  );
}

export async function lastIOSDocument(): Promise<string | null> {
  return (await recentIOSDocuments())[0] ?? null;
}

export async function rememberIOSDocument(path: string | null): Promise<void> {
  // Only ever added to, never cleared: the blank tab every launch starts
  // with would otherwise wipe it before startup gets to read it.
  if (!isMobileApp || !path) return;
  return updateRecents(async (list) => {
    const stored = storedDocumentPath(path, await documentsDir());
    return [stored, ...list.filter((p) => p !== stored)];
  });
}

/** Drops an entry that no longer opens (moved or deleted in Files). */
export function forgetIOSDocument(path: string): Promise<void> {
  return updateRecents(async (list) => {
    const docs = await documentsDir();
    const gone = storedDocumentPath(path, docs);
    return list.filter((entry) => storedDocumentPath(entry, docs) !== gone);
  });
}

/** Whether a document is in the app's own Documents folder. A file picked
 *  from elsewhere grants access to itself only, so it can't be renamed or deleted. */
export async function inIOSDocuments(path: string): Promise<boolean> {
  return storedDocumentPath(path, await documentsDir()).startsWith(
    IN_DOCUMENTS,
  );
}

/** Renames a document in Documents and keeps the recent list pointing at
 *  it. Returns the new path. */
export async function renameIOSDocument(
  path: string,
  name: string,
): Promise<string> {
  const renamed = await renameSandboxEntry(path, name);
  // Rust answers with the canonical spelling (/private/var/…).
  const docs = await documentsDir();
  const before = storedDocumentPath(path, docs);
  const after = storedDocumentPath(renamed, docs);
  await updateRecents((list) => list.map((p) => (p === before ? after : p)));
  return renamed;
}

/** Deletes a document in Documents and drops it from the recent list. */
export async function deleteIOSDocument(path: string): Promise<void> {
  await deleteSandboxEntry(path);
  await forgetIOSDocument(path);
}
