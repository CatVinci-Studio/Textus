import { filesChanged } from "../chat/file-changes";
import { isInside } from "../../utils/path";
import { fs } from "../../platform/ipc-files";
import { getWindowAccess } from "../../plugins/app-bridge";
import { openDocumentAt } from "../../registry/open-documents";
import { isRecord } from "../../utils/is-record";
import type { ToolCallFields } from "./acp-client";

/**
 * The files an external agent reads and writes through Textus (ACP's fs
 * methods): open documents as their editors have them, inside its folder.
 */

/** What an agent reads or writes through Textus stays in its session's
 *  folder and out of hidden folders, as Textus AI's own tools do. */
/** Whether `path` is in `folder` and out of its hidden folders. */
function insideFolder(folder: string, path: string): boolean {
  const rest = isInside(path, folder) ? path.slice(folder.length) : null;
  const parts = rest?.split(/[\\/]/).filter(Boolean) ?? [];
  return !!rest && !parts.some((part) => part.startsWith("."));
}

function withinFolder(folder: string, path: string): void {
  if (!insideFolder(folder, path))
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
 *  beside it. An agent's changes are written as they are, unmarked. */
export async function writeForAgent(
  cwd: string,
  { path, content }: { path: string; content: string },
) {
  withinFolder(cwd, path);
  const doc = openDocumentAt(path);
  if (doc) {
    if (!doc.replaceText(content, doc.revision()))
      throw new Error(`${path} changed while it was being written.`);
    await getWindowAccess()?.saveAt(path);
  } else await fs.writeTextFile(path, content);
  filesChanged([{ file: path, applied: true }]);
  return null;
}

/** Steps that change files. */
const EDIT_KINDS = new Set(["edit", "delete", "move"]);

/** Each edit step's files as they were on disk before it, by step id. */
export type EditSnapshots = Map<string, Map<string, Promise<string | null>>>;

/** The files a step touches: its places, else the path in its input. */
function pathsOf(fields: ToolCallFields): string[] {
  const input = isRecord(fields.rawInput) ? fields.rawInput : {};
  const named = [input.file_path, input.path].filter(
    (p): p is string => typeof p === "string",
  );
  return [...(fields.locations ?? []).map((l) => l.path), ...named];
}

const onDisk = (path: string) => fs.readTextFile(path).catch(() => null);

/**
 * Most agents write files themselves, not through Textus: an edit step's
 * files are kept as they were when it is first heard of, and once it ends,
 * those it changed are read again (the open ones take the new text as one
 * undo step: useExternalChangeReload).
 */
export function followEdit(
  snapshots: EditSnapshots,
  cwd: string,
  fields: ToolCallFields,
): void {
  const id = fields.toolCallId;
  const done = fields.status === "completed" || fields.status === "failed";
  let files = snapshots.get(id);
  if (!files && fields.kind && !EDIT_KINDS.has(fields.kind)) return;
  if (!done) {
    for (const path of pathsOf(fields)) {
      if (!insideFolder(cwd, path) || files?.has(path)) continue;
      if (!files) snapshots.set(id, (files = new Map()));
      files.set(path, onDisk(path));
    }
    return;
  }
  snapshots.delete(id);
  for (const [path, was] of files ?? [])
    void Promise.all([was, onDisk(path)]).then(([before, after]) => {
      if (after !== null && after !== before)
        filesChanged([{ file: path, applied: true }]);
    });
}
