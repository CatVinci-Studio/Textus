import { toEditorText } from "../document/file-format";
import { defaultMarkdownFilename } from "../document/save-default-name";
import { imageMimeForPath } from "../editor/images/pasted-files";

/** What the playground's Import button and a drop on the page take. */
export const IMPORT_EXTENSIONS = [".md", ".markdown", ".txt"];

export type FileKind = "markdown" | "image" | "other";

/** Sorts a picked or dropped file by its name (and type, for an image
 *  pasted from a screenshot tool, which has no useful name). */
export function fileKind(file: { name: string; type: string }): FileKind {
  const name = file.name.toLowerCase();
  if (IMPORT_EXTENSIONS.some((ext) => name.endsWith(ext))) return "markdown";
  if (file.type.startsWith("image/") || imageMimeForPath(name)) return "image";
  return "other";
}

/** A file's text as the editor wants it: no BOM, "\n" line breaks. */
export async function readMarkdownFile(file: Blob): Promise<string> {
  return toEditorText(await file.text());
}

/** The name an exported document downloads under: its first heading, or
 *  first line, as the desktop app's Save dialog suggests. */
export function exportFilename(markdown: string, fallback: string): string {
  return defaultMarkdownFilename(markdown, fallback, true);
}

/** Hands the document to the browser as a .md download - made in the page,
 *  nothing uploaded. */
export function downloadMarkdown(markdown: string, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // After the click has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
