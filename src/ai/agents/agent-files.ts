import { filesChanged } from "../chat/file-changes";
import { isInside } from "../../utils/path";
import { fs } from "../../platform/ipc-files";
import { getWindowAccess } from "../../plugins/app-bridge";
import { openDocumentAt } from "../../registry/open-documents";

/**
 * The files an external agent reads and writes through Textus (ACP's fs
 * methods): open documents as their editors have them, inside its folder.
 */

/** What an agent reads or writes through Textus stays in its session's
 *  folder and out of hidden folders, as Textus AI's own tools do. */
function withinFolder(folder: string, path: string): void {
  const rest = isInside(path, folder) ? path.slice(folder.length) : null;
  const parts = rest?.split(/[\\/]/).filter(Boolean) ?? [];
  if (!rest || parts.some((part) => part.startsWith(".")))
    throw new Error(`${path} is outside the folder this session works in.`);
}

/** `content` from line `line` (1-based), at most `limit` lines. */
function lines(content: string, line?: number | null, limit?: number | null) {
  if (!line && !limit) return content;
  const all = content.split("\n");
  const from = Math.max(0, (line ?? 1) - 1);
  return all.slice(from, limit ? from + limit : undefined).join("\n");
}

/** An open document as the editor has it, typed or not. */
export async function readForAgent(
  cwd: string,
  {
    path,
    line,
    limit,
  }: { path: string; line?: number | null; limit?: number | null },
) {
  withinFolder(cwd, path);
  const doc = openDocumentAt(path);
  const content = doc ? doc.text() : await fs.readTextFile(path);
  return { content: lines(content, line, limit) };
}

/** An open document is changed in its editor, one undo step, and saved:
 *  read again from disk, it would start over and lose the conversation
 *  beside it. Either way the file is marked as Textus AI's own changes
 *  are, each place in it put back from the editor. */
export async function writeForAgent(
  cwd: string,
  { path, content }: { path: string; content: string },
) {
  withinFolder(cwd, path);
  const doc = openDocumentAt(path);
  if (doc) {
    const before = doc.text();
    if (!doc.replaceText(content, doc.revision()))
      throw new Error(`${path} changed while it was being written.`);
    await getWindowAccess()?.saveAt(path);
    filesChanged([{ file: path, applied: true, before }]);
    return null;
  }
  const before = await fs.readTextFile(path).catch(() => null);
  await fs.writeTextFile(path, content);
  filesChanged([{ file: path, applied: true, before }]);
  return null;
}
