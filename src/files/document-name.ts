import { TEXT_DOCUMENT_EXTENSIONS } from "../platform/bindings/files";

/** What Textus opens as a document, listed before every other file. */
const DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set(
  TEXT_DOCUMENT_EXTENSIONS,
);

/** Whether a file name is a document's. Its own module: the file tree
 *  reads it without the search's filters. */
export function isDocumentName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && DOCUMENT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}
