import { useSyncExternalStore } from "react";
import { fs } from "../platform/ipc";
import { basename, joinPath, parentDir } from "../utils/path";
import {
  pluginsSnapshot,
  runningPlugins,
  subscribePlugins,
} from "../plugins/store/plugin-records";

/**
 * Folders opened as one document (a plugin's `contributes.folderDocuments`,
 * such as `.textbundle`): shown in the sidebar as a document, opening the
 * first of the plugin's document names found inside.
 */

/** The document names a folder named `name` is opened by; null for a
 *  folder that is a folder. */
export function folderDocumentOf(name: string): readonly string[] | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  for (const record of runningPlugins(pluginsSnapshot()))
    for (const type of record.manifest.contributes.folderDocuments)
      if (type.extension === ext) return type.documents;
  return null;
}

/** The extensions of folders opened as documents now, as one string. */
function folderDocumentKey(): string {
  return runningPlugins(pluginsSnapshot())
    .flatMap((r) => r.manifest.contributes.folderDocuments)
    .map((type) => type.extension)
    .sort()
    .join(" ");
}

/** Changes when a plugin starts or stops opening folders as documents. */
export const useFolderDocumentKinds = (): string =>
  useSyncExternalStore(subscribePlugins, folderDocumentKey);

/** The document the folder at `dir` opens as: the first of its names
 *  found in it; null when it holds none. */
async function folderDocumentIn(dir: string): Promise<string | null> {
  const names = folderDocumentOf(basename(dir));
  if (!names) return null;
  const entries = await fs.listDir(dir).catch(() => []);
  const found = names.find((name) =>
    entries.some((e) => !e.is_dir && e.name === name),
  );
  return found ? joinPath(dir, found) : null;
}

/** The folder document `path` is the document of, if it is one. */
export function folderDocumentAround(path: string | null): string | null {
  if (!path) return null;
  const dir = parentDir(path);
  const names = dir ? folderDocumentOf(basename(dir)) : null;
  return names?.includes(basename(path)) ? dir : null;
}

/** `path`, or the document inside it when it is a folder document. */
export async function documentPathOf(path: string): Promise<string> {
  if (!folderDocumentOf(basename(path))) return path;
  return (await folderDocumentIn(path)) ?? path;
}
