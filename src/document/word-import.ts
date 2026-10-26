import { fs } from "../platform/ipc";
import { isIOSApp } from "../platform/capabilities";
import { basename, dirname } from "../utils/path";
import type { DocTab } from "./doc-tabs";

/**
 * A .docx opens as a new, unsaved Markdown document named after it; the
 * Word file is only read. Desktop only: iOS hands over security-scoped URLs
 * the converter can't open.
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
