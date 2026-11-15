import { useEffect } from "react";
import { fs } from "../platform/ipc";
import { isNoteFile } from "../utils/path";
import { getUiState, setUiState } from "../storage/ui-state";
import {
  knownDocumentsDir,
  resolvedDocumentPath,
  storedDocumentPath,
  storedOwnFolder,
} from "../platform/documents-path";

/** iOS moves the app's Documents on a reinstall: its folders and tabs are
 *  kept relative to it ("documents:…"), as the open folder is; read back
 *  the same way wherever the Documents folder is known. */
const docsNow = () => knownDocumentsDir();
const keptFolder = (folder: string) =>
  storedOwnFolder(trimmed(folder), docsNow());

/**
 * What a project opened from the start page shows, as editors do: the tabs
 * it was left with; else the document last opened in it; else its README;
 * else no document, only its files in the sidebar.
 */

/** A project's tabs as it was left: their paths, the one in front last. */
type ProjectTabs = Record<string, string[]>;

const PROJECTS_KEPT = 20;
const TABS_KEPT = 20;

const trimmed = (folder: string) => folder.replace(/[\\/]+$/, "");
const inside = (folder: string, path: string) => {
  const root = trimmed(folder);
  // "documents:", Documents itself as kept on iOS: all of it is inside.
  if (root.endsWith(":")) return path.startsWith(root) && path !== root;
  return path.startsWith(root + "/") || path.startsWith(root + "\\");
};

/** `all` with `folder`'s tabs set to those of `paths` inside it, `active`
 *  last; the least recent projects dropped past PROJECTS_KEPT. */
export function withProjectTabs(
  all: ProjectTabs,
  folder: string,
  paths: readonly string[],
  active: string | null,
): ProjectTabs {
  const mine = paths.filter((p) => inside(folder, p) && p !== active);
  if (active && inside(folder, active)) mine.push(active);
  if (mine.length === 0) return all;
  const key = trimmed(folder);
  const rest = Object.entries(all).filter(([k]) => k !== key);
  return Object.fromEntries([
    ...rest.slice(-(PROJECTS_KEPT - 1)),
    [key, mine.slice(-TABS_KEPT)],
  ]);
}

/** Keeps the open folder's tabs, for the start page to bring back. */
export function useProjectTabs(
  folder: string | null,
  paths: readonly (string | null)[],
  active: string | null,
): void {
  const key = paths.filter(Boolean).join("\n");
  useEffect(() => {
    if (!folder) return;
    const all = (getUiState("projectTabs") ?? {}) as ProjectTabs;
    const docs = docsNow();
    const kept = (p: string) => storedDocumentPath(p, docs);
    const next = withProjectTabs(
      all,
      keptFolder(folder),
      key.split("\n").filter(Boolean).map(kept),
      active && kept(active),
    );
    if (next !== all) setUiState("projectTabs", next);
  }, [folder, key, active]);
}

/** The README a project opens with when nothing was open in it. */
function projectReadme(
  entries: readonly { name: string; path: string; is_dir: boolean }[],
): string | null {
  const readme = entries.find(
    (e) =>
      !e.is_dir &&
      isNoteFile(e.name) &&
      /^readme\.(md|markdown)$/i.test(e.name),
  );
  return readme?.path ?? null;
}

// Gone is a file not found; one it may not look at that way (Android's
// shared storage, read through the system) may well be there: opened, it
// says for itself.
const exists = (path: string) =>
  fs.fileMtimeMs(path).then(
    (t) => t !== null,
    () => true,
  );

/** The documents `folder` opens with, the one in front last; none when it
 *  has no tabs kept, no recent document and no README. */
export async function openingDocuments(
  folder: string,
  recentFiles: readonly string[],
): Promise<string[]> {
  const all = (getUiState("projectTabs") ?? {}) as ProjectTabs;
  const docs = docsNow();
  const kept = (all[keptFolder(folder)] ?? all[trimmed(folder)])?.map((p) =>
    docs ? resolvedDocumentPath(p, docs) : p,
  );
  if (kept?.length) {
    const found = await Promise.all(kept.map(exists));
    const left = kept.filter((_, i) => found[i]);
    if (left.length) return left;
  }
  const recent = recentFiles.find((f) => inside(folder, f));
  if (recent) return [recent];
  const readme = projectReadme(await fs.listDir(folder).catch(() => []));
  return readme ? [readme] : [];
}
