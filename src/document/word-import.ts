import { fs } from "../platform/ipc";
import { isIOSApp } from "../platform/capabilities";
import { basename, dirname } from "../utils/path";
import type { DocTab } from "./doc-tabs";

/**
 * Opening a Word document (.docx) - File > Open, a drop on the window, a
 * path from the OS - makes a new Markdown document of it: unsaved, named
 * after the Word file, its text converted by the backend
 * (commands/word_import.rs) and its pictures kept where a pasted picture of
 * an unsaved document is, until the first save moves them into the image
 * folder (editor/images/image-migration.ts). The Word file is only read:
 * the tab has no path, so nothing is ever written back to it, and Save As
 * starts beside it with a .md name.
 *
 * Desktop only: on iOS a picked document is a security-scoped URL the
 * backend's converter can't open, and the Files picker offers Markdown and
 * text only.
 */
export function isWordDocument(path: string): boolean {
  return !isIOSApp && /\.docx$/i.test(path);
}

/** The tab a Word document opens as: a draft holding its Markdown. */
export async function wordDocumentTab(path: string): Promise<Partial<DocTab>> {
  const { markdown } = await fs.openWordDocument(path);
  return {
    path: null,
    content: markdown,
    // Unsaved from the start, so closing it asks to save.
    savedContent: "",
    diskMtime: null,
    importedFrom: path,
  };
}

/** Where Save As suggests a document made from the Word file `path`: a
 *  Markdown file of the same name, in the same folder. */
export function wordSaveSuggestion(path: string): {
  name: string;
  dir: string;
} {
  return {
    name: `${basename(path).replace(/\.docx$/i, "")}.md`,
    dir: dirname(path),
  };
}
