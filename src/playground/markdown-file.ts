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

/** The File System Access API, where the browser has it (Chromium). */
interface FilePickers {
  showOpenFilePicker?: (options: object) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options: object) => Promise<FileSystemFileHandle>;
}
const pickers = () => window as unknown as FilePickers;

const MARKDOWN_TYPES = [
  {
    description: "Markdown",
    accept: { "text/markdown": [".md", ".markdown"], "text/plain": [".txt"] },
  },
];

/** Whether Open… can keep the file to save back into. */
export function canOpenFiles(): boolean {
  return typeof pickers().showOpenFilePicker === "function";
}

/** Files picked to open, each with its handle; null when cancelled. */
export async function pickMarkdownFiles(): Promise<
  { file: File; handle: FileSystemFileHandle }[] | null
> {
  try {
    const handles = await pickers().showOpenFilePicker!({
      multiple: true,
      types: MARKDOWN_TYPES,
    });
    return Promise.all(
      handles.map(async (handle) => ({ file: await handle.getFile(), handle })),
    );
  } catch {
    return null;
  }
}

/**
 * Saves `markdown`: into `handle` when the document came from a file or
 * was saved before, else where the browser's save picker says, else as a
 * download. The handle it went into, or null for a download or a cancel
 * (`cancelled` true for that).
 */
export async function saveMarkdownFile(
  markdown: string,
  filename: string,
  handle: FileSystemFileHandle | null,
): Promise<{ handle: FileSystemFileHandle | null; cancelled: boolean }> {
  let target = handle;
  if (!target && typeof pickers().showSaveFilePicker === "function") {
    try {
      target = await pickers().showSaveFilePicker!({
        suggestedName: filename,
        types: MARKDOWN_TYPES,
      });
    } catch {
      return { handle: null, cancelled: true };
    }
  }
  if (!target) {
    downloadMarkdown(markdown, filename);
    return { handle: null, cancelled: false };
  }
  const writable = await target.createWritable();
  await writable.write(markdown);
  await writable.close();
  return { handle: target, cancelled: false };
}
