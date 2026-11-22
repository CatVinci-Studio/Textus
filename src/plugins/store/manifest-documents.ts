import type {
  CodeLanguageContribution,
  DocumentTypeContribution,
  FolderDocumentContribution,
} from "./manifest-types";
import { ManifestError, list, object, text, type Json } from "./manifest-json";
import { TEXT_DOCUMENT_EXTENSIONS } from "../../platform/bindings/files";

const EXTENSION = /^[a-z0-9][a-z0-9_-]{0,15}$/;
/** Textus's own; a plugin can't take them over. */
const OWN: readonly string[] = TEXT_DOCUMENT_EXTENSIONS;

const flag = (value: unknown, what: string): boolean => {
  if (value === undefined) return false;
  if (typeof value !== "boolean")
    throw new ManifestError(`${what} must be true or false.`);
  return value;
};

/** `contributes.documentTypes`: extensions opened as documents, with what
 *  of their syntax is kept as written. Data only, no patterns: it runs on
 *  every read of the document. */
export function parseDocumentTypes(c: Json): DocumentTypeContribution[] {
  return list(c.documentTypes, "contributes.documentTypes").map((x, i) => {
    const at = `contributes.documentTypes[${i}]`;
    const o = object(x, at);
    const extensions = list(o.extensions, `${at}.extensions`).map((e, j) => {
      const ext = text(e, `${at}.extensions[${j}]`)
        .replace(/^\./, "")
        .toLowerCase();
      if (!EXTENSION.test(ext))
        throw new ManifestError(`${at}.extensions[${j}] isn't an extension.`);
      if (OWN.includes(ext))
        throw new ManifestError(`${at}.extensions[${j}] is Textus's own.`);
      return ext;
    });
    if (!extensions.length)
      throw new ManifestError(`${at}.extensions is empty.`);
    const keep = o.keep === undefined ? {} : object(o.keep, `${at}.keep`);
    const blockStarts = list(keep.blockStarts, `${at}.keep.blockStarts`).map(
      (s, j) => text(s, `${at}.keep.blockStarts[${j}]`),
    );
    const braces = flag(keep.braces, `${at}.keep.braces`);
    const jsx = flag(keep.jsx, `${at}.keep.jsx`);
    return {
      extensions,
      keep:
        blockStarts.length || braces || jsx
          ? { blockStarts, braces, jsx }
          : null,
    };
  });
}

/** `contributes.folderDocuments`: folders with an extension opened as one
 *  document, the first of `documents` found in them. */
export function parseFolderDocuments(c: Json): FolderDocumentContribution[] {
  return list(c.folderDocuments, "contributes.folderDocuments").map((x, i) => {
    const at = `contributes.folderDocuments[${i}]`;
    const o = object(x, at);
    const extension = text(o.extension, `${at}.extension`)
      .replace(/^\./, "")
      .toLowerCase();
    if (!EXTENSION.test(extension))
      throw new ManifestError(`${at}.extension isn't an extension.`);
    const documents = list(o.documents, `${at}.documents`).map((d, j) => {
      const name = text(d, `${at}.documents[${j}]`);
      if (/[\\/]/.test(name) || name.startsWith("."))
        throw new ManifestError(`${at}.documents[${j}] isn't a file name.`);
      return name;
    });
    if (!documents.length) throw new ManifestError(`${at}.documents is empty.`);
    return { extension, documents };
  });
}

const LANGUAGE_NAME = /^[a-z0-9][a-z0-9+#._-]{0,31}$/;

/** `contributes.codeLanguages`: languages coloured from a grammar file,
 *  read only once a fence names one. `taken` are the fences Textus draws
 *  itself (mermaid, math); a name refractor colours is left to it at
 *  lookup, as reading its list here would load it at startup. */
export function parseCodeLanguages(
  c: Json,
  taken: readonly string[],
): CodeLanguageContribution[] {
  return list(c.codeLanguages, "contributes.codeLanguages").map((x, i) => {
    const at = `contributes.codeLanguages[${i}]`;
    const o = object(x, at);
    const name = (value: unknown, what: string) => {
      const word = text(value, what).toLowerCase();
      if (!LANGUAGE_NAME.test(word))
        throw new ManifestError(`${what} "${word}" isn't a fence's language.`);
      if (taken.includes(word))
        throw new ManifestError(`${what} "${word}" is drawn by Textus itself.`);
      return word;
    };
    const path = text(o.path, `${at}.path`);
    if (!/\.json$/i.test(path) || path.split(/[\\/]/).includes(".."))
      throw new ManifestError(`${at}.path must be a .json file of the plugin.`);
    return {
      id: name(o.id, `${at}.id`),
      aliases: list(o.aliases, `${at}.aliases`).map((a, j) =>
        name(a, `${at}.aliases[${j}]`),
      ),
      path,
    };
  });
}
