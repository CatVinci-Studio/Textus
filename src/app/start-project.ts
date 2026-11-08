import { fs } from "../platform/ipc";
import { isNoteFile } from "../utils/path";

/**
 * The document a project opened from the start page shows, so the window
 * moves on from the start page instead of only filling the sidebar: the last
 * one opened in it, else its README, else its first note by name.
 */
export function projectDocument(
  folder: string,
  recentFiles: readonly string[],
  entries: readonly { name: string; path: string; is_dir: boolean }[],
): string | null {
  const root = folder.replace(/[\\/]+$/, "");
  const recent = recentFiles.find(
    (f) => f.startsWith(root + "/") || f.startsWith(root + "\\"),
  );
  if (recent) return recent;
  const notes = entries
    .filter((e) => !e.is_dir && isNoteFile(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const readme = notes.find((e) => /^readme\.(md|markdown)$/i.test(e.name));
  return (readme ?? notes[0])?.path ?? null;
}

/** `folder`'s document as projectDocument picks it; null for none. */
export async function openingDocument(
  folder: string,
  recentFiles: readonly string[],
): Promise<string | null> {
  const entries = await fs.listDir(folder).catch(() => []);
  return projectDocument(folder, recentFiles, entries);
}
