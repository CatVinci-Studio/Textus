import { fill } from "../i18n/fill";
import { notesRoot, renameRule } from "./link-style";
import { fs } from "../platform/ipc";
import type { Strings } from "../i18n/strings";
import { unsavedDocumentAt } from "../registry/open-documents";
import { linkRewrite } from "./link-rewrite-lazy";
import { showConfirm, showMessage } from "../engine/controls/app-dialog";
import { FILE_WRITTEN_EVENT, sendAppEvent } from "../utils/events";
import { basename, isWithin } from "../utils/path";

/** A document's text a link update changed: where it is, and its text
 *  before and after. */
export interface TextEdit {
  path: string;
  before: string;
  after: string;
}

/**
 * After the sidebar renamed or moved `from` to `to`: the links to it, and its
 * own relative links, made to lead where they did. In an Obsidian vault that
 * happens at once, as Obsidian does; elsewhere the user is asked first. `base`
 * is the folder the sidebar shows. Returns what it wrote, for an undo.
 */
export async function updateLinksAfterMove(
  from: string,
  to: string,
  base: string,
  t: Strings,
): Promise<TextEdit[]> {
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
    return []; // too broad a folder, or gone: nothing to search
  }
  const { linkPlanner } = await linkRewrite.load();
  const planner = linkPlanner(files, { root, from, to, linkRoot });
  // What is typed in a tab counts, not the copy on disk.
  const current = documents.map((d) => ({
    path: d.path,
    text: unsavedDocumentAt(d.path)?.text() ?? d.text,
  }));
  const updates = current.flatMap((doc) => planner(doc) ?? []);
  if (updates.length === 0) return [];
  const update = renameRule(conventions);
  if (update === "never") return [];
  const automatic = update === "always";
  if (
    !automatic &&
    !(await showConfirm(
      fill(t.treeUpdateLinksConfirm, { name: basename(to) }),
      { okLabel: t.treeUpdateLinks, cancelLabel: t.treeKeepLinks },
    ))
  )
    return [];
  const failed: string[] = [];
  const written: TextEdit[] = [];
  for (const { path } of updates) {
    // Planned again on the text as it is now: it may have changed meanwhile.
    const changed = await rewrite(
      path,
      (text) => planner({ path, text })?.text ?? text,
    );
    if (changed === null) failed.push(path);
    else if (changed) written.push({ path, ...changed });
  }
  if (failed.length) await sayFailed(failed, t);
  return written;
}

/** The document at `path` (its tab's text, else the file's) made `next` of
 *  it: what it was and became, false when nothing changed, null when it
 *  couldn't be written. */
async function rewrite(
  path: string,
  next: (text: string) => string,
): Promise<Omit<TextEdit, "path"> | false | null> {
  try {
    const open = unsavedDocumentAt(path);
    const before = open ? open.text() : await fs.readTextFile(path);
    const after = next(before);
    if (after === before) return false;
    if (open)
      return open.replaceText(after, open.revision())
        ? { before, after }
        : null;
    await fs.writeTextFile(path, after);
    sendAppEvent(FILE_WRITTEN_EVENT, path);
    return { before, after };
  } catch {
    return null;
  }
}

async function sayFailed(failed: readonly string[], t: Strings) {
  await showMessage(
    fill(t.treeUpdateLinksFailed, { names: failed.map(basename).join(", ") }),
    { tone: "error" },
  );
}

/** `edits` written while `moved` was where it is now, taken back after it
 *  went back to where it was: each document still as the edit left it gets
 *  its text before; one changed since is passed over, and said. Returns the
 *  edits as they now stand, to take back in turn. */
export async function revertEdits(
  edits: readonly TextEdit[],
  moved: readonly { from: string; to: string }[],
  t: Strings,
): Promise<TextEdit[]> {
  const back = (path: string) => {
    const m = moved.find(({ to }) => isWithin(path, to));
    return m ? m.from + path.slice(m.to.length) : path;
  };
  const skipped: string[] = [];
  const done: TextEdit[] = [];
  for (const edit of edits) {
    const path = back(edit.path);
    const changed = await rewrite(path, (text) =>
      text === edit.after ? edit.before : text,
    );
    if (changed) done.push({ path, before: edit.after, after: edit.before });
    else skipped.push(path);
  }
  if (skipped.length) await sayFailed(skipped, t);
  return done;
}
