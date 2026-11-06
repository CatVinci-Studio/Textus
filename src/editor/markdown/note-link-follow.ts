import type { EditorView } from "@milkdown/kit/prose/view";
import { fs } from "../../platform/ipc";
import { OPEN_FILE_IN_TAB_EVENT, type OpenFileInTab } from "../../utils/events";
import { noteJump } from "../../utils/nav-history";
import { basename, dirname, isNoteFile } from "../../utils/path";
import { parseNoteLink, type NoteLink } from "../../utils/note-link";
import { revealHeading } from "./heading-jump";

/** Where in a note a link points: `^id` for a block, `A#B` for nested
 *  headings; undefined for its top. */
export function linkAnchor(link: NoteLink): string | undefined {
  if (link.block) return `^${link.block}`;
  return link.headings.join("#") || undefined;
}

function open(detail: OpenFileInTab): void {
  window.dispatchEvent(
    new CustomEvent<OpenFileInTab>(OPEN_FILE_IN_TAB_EVENT, { detail }),
  );
}

/** A note a link names that isn't there yet, made empty so the link leads
 *  somewhere; never over a file (the backend refuses a taken name). */
async function createNote(path: string): Promise<boolean> {
  const dir = dirname(path);
  if ((await fs.fileMtimeMs(dir)) === null)
    await fs.createFolder(dirname(dir), basename(dir)).catch(() => {});
  return fs.createDocument(dir, basename(path)).then(
    () => true,
    () => false,
  );
}

/**
 * Follows a wikilink's source, or a Markdown link's target the plain path
 * didn't find, from the document at `docPath`: a note opens at its heading
 * or block, any other file as a linked file, and a wikilink to a note that
 * doesn't exist creates it where the vault puts new notes.
 */
export async function followNoteLink(
  view: EditorView,
  written: string,
  docPath: string | null,
  folder: string | null,
): Promise<void> {
  const link = parseNoteLink(written);
  if (!link) return;
  const anchor = linkAnchor(link);
  if (!link.note) {
    if (anchor) {
      noteJump();
      revealHeading(view, anchor);
    }
    return;
  }
  if (!docPath) return;
  const target = await fs.resolveNoteLink(
    docPath,
    link.note,
    folder,
    link.wiki,
  );
  if (!target) return;
  if (!isNoteFile(target.path)) {
    if (target.exists) open({ path: target.path, linked: true });
    return;
  }
  if (!target.exists && !(link.wiki && (await createNote(target.path)))) return;
  open({ path: target.path, anchor });
}
