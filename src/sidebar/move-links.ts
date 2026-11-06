import { fs } from "../platform/ipc";
import type { Strings } from "../i18n/strings";
import { getWindowAccess } from "../plugins/app-bridge";
import { planLinkUpdates } from "../plugins/workspace/link-rewrite";
import { showConfirm, showMessage } from "../ui/app-dialog";
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
  const vault = await fs.obsidianVault(to).catch(() => null);
  const root = vault?.root ?? base;
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
  const plan = { root, from, to, vault: !!vault };
  // What is typed in a tab counts, not the copy on disk.
  const tab = (path: string) => getWindowAccess()?.documentAt(path) ?? null;
  const current = documents.map((d) => ({
    path: d.path,
    text: tab(d.path)?.text() ?? d.text,
  }));
  const updates = planLinkUpdates(current, files, plan);
  if (updates.length === 0) return;
  const automatic = !!vault && vault.alwaysUpdateLinks !== false;
  if (
    !automatic &&
    !(await showConfirm(
      t.treeUpdateLinksConfirm.replace("{name}", basename(to)),
      { okLabel: t.treeUpdateLinks, cancelLabel: t.treeKeepLinks },
    ))
  )
    return;
  const failed: string[] = [];
  for (const { path } of updates) {
    // Planned again on the text as it is now: it may have changed meanwhile.
    const again = (text: string) =>
      planLinkUpdates([{ path, text }], files, plan)[0]?.text ?? text;
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
      t.treeUpdateLinksFailed.replace(
        "{names}",
        failed.map(basename).join(", "),
      ),
      { tone: "error" },
    );
}
