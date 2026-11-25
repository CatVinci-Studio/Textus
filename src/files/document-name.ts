import { basename, extname } from "../utils/path";
import {
  BUILT_IN_KEEP,
  type VerbatimRules,
} from "../editor/markdown/verbatim-rules";
import {
  pluginsSnapshot,
  runningPlugins,
} from "../plugins/store/plugin-records";

/** A file Textus opens as a document, and what of its syntax the editor
 *  keeps exactly as written (none for plain Markdown and text). */
interface DocumentType {
  keep: VerbatimRules | null;
}

/** Textus's own, by extension; a plugin's `documentTypes` add others. */
const CORE_DOCUMENT_TYPES: Readonly<Record<string, DocumentType>> = {
  md: { keep: null },
  markdown: { keep: null },
  mdx: { keep: BUILT_IN_KEEP.mdx },
  txt: { keep: null },
  text: { keep: null },
};

/** The document type of a file name or path, from Textus or a plugin
 *  that is on; null for any other file. */
export function documentTypeOf(name: string | null): DocumentType | null {
  const file = name ? basename(name) : "";
  const dot = file.lastIndexOf(".");
  // ".md" alone is a hidden file's name, not a type.
  if (dot <= 0) return null;
  const ext = file.slice(dot + 1).toLowerCase();
  const core = CORE_DOCUMENT_TYPES[ext];
  if (core) return core;
  for (const record of runningPlugins(pluginsSnapshot()))
    for (const type of record.manifest.contributes.documentTypes)
      if (type.extensions.includes(ext)) return { keep: type.keep };
  return null;
}

/** Whether a file name is a document's, listed before every other file. */
export const isDocumentName = (name: string): boolean =>
  documentTypeOf(name) !== null;

/** A text file that isn't a document, shown as plain text in the source
 *  editor: editable and coloured as `language` when a running plugin's
 *  `textFiles` claims its extension, otherwise read-only and coloured by
 *  its name. Null for a document. */
export interface TextFileType {
  language: string | null;
  claimed: boolean;
}

export function textFileOf(path: string | null): TextFileType | null {
  if (!path || isDocumentName(path)) return null;
  const ext = extname(path).slice(1).toLowerCase();
  for (const record of runningPlugins(pluginsSnapshot()))
    for (const type of record.manifest.contributes.textFiles)
      if (type.extensions.includes(ext))
        return { language: type.language, claimed: true };
  return { language: null, claimed: false };
}
