import { fill } from "../i18n/fill";
import { notesRoot, renameRule } from "./link-style";
import { fs } from "../platform/ipc";
import type { Strings } from "../i18n/strings";
import { getWindowAccess } from "../plugins/app-bridge";
import { linkPlanner } from "./link-rewrite";
import { showConfirm, showMessage } from "../engine/controls/app-dialog";
import { FILE_WRITTEN_EVENT } from "../utils/events";
import { basename } from "../utils/path";

/**
 * After the sidebar renamed or moved `from` to `to`: the links to it, and its
 * own relative links, made to lead where they did. In an Obsidian vault that
 * happens at once, as Obsidian does; elsewhere the user is asked first. `base`
 * is the folder the sidebar shows.
 */
export async function updateLinksAfterMove(
  from: string,
  to: string,
  base: string,
  t: Strings,
): Promise<void> {
  const [conventions, linkRoot] = await Promise.all([
    fs.folderConventions(to).catch(() => null),
    fs.documentLinkRoot(to, base).catch(() => null),
  ]);
  // Links by name are found in the folder of the app that writes them.
  const root = notesRoot(conventions) ?? base;
  let documents: { path: string; text: string }[];
  let files: string[];
  try {
    const [docs, index] = await Promise.all([
      fs.folderDocuments(root),
      fs.indexFolder(root),
    ]);
    documents = docs.documents;
    files = index.files.map((f) => f.path);
  } catch {
    return; // too broad a folder, or gone: nothing to search
  }
  const planner = linkPlanner(files, { root, from, to, linkRoot });
  // What is typed in a tab counts, not the copy on disk.
  const tab = (path: string) => getWindowAccess()?.documentAt(path) ?? null;
  const current = documents.map((d) => ({
    path: d.path,
    text: tab(d.path)?.text() ?? d.text,
  }));
  const updates = current.flatMap((doc) => planner(doc) ?? []);
  if (updates.length === 0) return;
  const update = renameRule(conventions);
  if (update === "never") return;
  const automatic = update === "always";
  if (
    !automatic &&
    !(await showConfirm(
      fill(t.treeUpdateLinksConfirm, { name: basename(to) }),
      { okLabel: t.treeUpdateLinks, cancelLabel: t.treeKeepLinks },
    ))
  )
    return;
  const failed: string[] = [];
  for (const { path } of updates) {
    // Planned again on the text as it is now: it may have changed meanwhile.
    const again = (text: string) => planner({ path, text })?.text ?? text;
    try {
      const open = tab(path);
      if (open) {
        if (!open.replaceText(again(open.text()), open.revision()))
          failed.push(path);
        continue;
      }
      const text = await fs.readTextFile(path);
      const next = again(text);
      if (next === text) continue;
      await fs.writeTextFile(path, next);
      window.dispatchEvent(
        new CustomEvent(FILE_WRITTEN_EVENT, { detail: path }),
      );
    } catch {
      failed.push(path);
    }
  }
  if (failed.length)
    await showMessage(
      fill(t.treeUpdateLinksFailed, { names: failed.map(basename).join(", ") }),
      { tone: "error" },
    );
}
