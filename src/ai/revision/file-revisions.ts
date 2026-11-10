import { useSyncExternalStore } from "react";
import { ai } from "../../platform/ipc";
import {
  getUiState,
  setUiState,
  type AiFileMark,
} from "../../storage/ui-state";
import type { EditProposal } from "../types";
import { blockHunks } from "./block-hunks";

/**
 * What Textus AI left in a file it didn't have open (aiChangeMode): a change
 * kept as revisions until the file's editor places them, a file it made
 * waiting to be kept, its text before a change written straight in. Kept
 * beside the file's undecided proposals, in the app's data, and marked in
 * the tree and on its tab (aiFileMarks).
 */

/** A change to the file, not yet placed in its editor. */
export interface IncomingRevision {
  /** Its changes' ids, in its conversation's record. */
  ids: string[];
  conversation: string;
  /** The file as the change found it, and as the change leaves it. */
  before: string;
  after: string;
  /** The file read otherwise when it opened: left out, listed in the
   *  conversation's card. */
  conflict?: boolean;
}

export interface FileRevisions {
  version: 1;
  incoming: IncomingRevision[];
  /** Made by Textus AI, waiting to be kept. */
  created?: { conversation: string; id: string };
  /** Its text before Textus AI wrote straight in. */
  base?: string;
}

/** Each file's store is its proposals' path, marked apart. */
const storeOf = (path: string) => `${path}#ai-changes`;

export async function readFileRevisions(
  path: string,
): Promise<FileRevisions | null> {
  const value = (await ai
    .keptProposalsRead(storeOf(path), null)
    .catch(() => null)) as Partial<FileRevisions> | null;
  if (!value || value.version !== 1 || !Array.isArray(value.incoming))
    return null;
  return value as FileRevisions;
}

export async function writeFileRevisions(
  path: string,
  value: FileRevisions | null,
): Promise<void> {
  const empty =
    !value ||
    (!value.incoming.length && !value.created && value.base === undefined);
  await ai
    .keptProposalsWrite(storeOf(path), null, empty ? null : value, [])
    .catch(() => undefined);
  window.dispatchEvent(new CustomEvent(FILE_REVISIONS_EVENT, { detail: path }));
}

/** Fired with a file's path when what Textus AI left in it changed. */
export const FILE_REVISIONS_EVENT = "textus-file-revisions";

// ---- Marks ----------------------------------------------------------

let marks: Record<string, AiFileMark> = readMarks();
const listeners = new Set<() => void>();

function readMarks(): Record<string, AiFileMark> {
  const stored = getUiState("aiFileMarks");
  return stored && typeof stored === "object" ? { ...stored } : {};
}

/** What Textus AI left in `path`, as the tree and its tab show it. */
export function setAiFileMark(path: string, patch: AiFileMark): void {
  const next = { ...marks[path], ...patch };
  if (!next.pending) delete next.pending;
  if (!next.created) delete next.created;
  if (!next.changed) delete next.changed;
  const was = JSON.stringify(marks[path] ?? {});
  if (JSON.stringify(next) === was) return;
  marks = { ...marks };
  if (Object.keys(next).length) marks[path] = next;
  else delete marks[path];
  setUiState("aiFileMarks", marks);
  for (const listener of listeners) listener();
}

export function aiFileMark(path: string): AiFileMark | undefined {
  return marks[path];
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAiFileMarks(): Readonly<Record<string, AiFileMark>> {
  return useSyncExternalStore(subscribe, () => marks);
}

// ---- From changes to revisions --------------------------------------

/** The places `before` and `after` differ, paragraph by paragraph: how
 *  many revisions a change makes, before its file's editor reads it. */
export function placesChanged(before: string, after: string): number {
  const blocks = (text: string) =>
    text
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean);
  return blockHunks(blocks(before), blocks(after)).length;
}

/** One change kept as revisions in its file: merged with what waits there
 *  already, from the earliest text it found to the latest it left. */
export async function keepAsRevisions(change: {
  file: string;
  id: string;
  conversation: string;
  before: string;
  after: string;
}): Promise<void> {
  const kept = (await readFileRevisions(change.file)) ?? {
    version: 1,
    incoming: [],
  };
  const open = kept.incoming.find((r) => !r.conflict);
  if (open) {
    open.ids.push(change.id);
    open.after = change.after;
  } else
    kept.incoming.push({
      ids: [change.id],
      conversation: change.conversation,
      before: change.before,
      after: change.after,
    });
  const waiting = kept.incoming.find((r) => !r.conflict)!;
  setAiFileMark(change.file, {
    pending:
      (aiFileMark(change.file)?.pending ?? 0) -
      (open ? placesChanged(open.before, open.after) : 0) +
      placesChanged(waiting.before, waiting.after),
  });
  await writeFileRevisions(change.file, kept);
}

/** A file Textus AI made, waiting to be kept. */
export async function keepAsCreated(change: {
  file: string;
  id: string;
  conversation: string;
}): Promise<void> {
  const kept = (await readFileRevisions(change.file)) ?? {
    version: 1,
    incoming: [],
  };
  kept.created = { conversation: change.conversation, id: change.id };
  setAiFileMark(change.file, { created: true });
  await writeFileRevisions(change.file, kept);
}

/** A file Textus AI made, kept by the writer or gone to the Trash: no
 *  longer waiting. */
export async function forgetCreated(file: string): Promise<void> {
  const kept = await readFileRevisions(file);
  if (kept) {
    delete kept.created;
    await writeFileRevisions(file, kept);
  }
  setAiFileMark(file, { created: false });
}

/** The revisions that turn the document's blocks into `after`'s: each run
 *  of blocks that differs replaced, deleted or added beside its
 *  neighbour, by the blocks' ids. */
export function revisionProposals(
  blocks: readonly { id: string; markdown: string }[],
  after: readonly string[],
): EditProposal[] {
  const hunks = blockHunks(
    blocks.map((b) => b.markdown),
    after,
  );
  return hunks.map(({ from, to, baseFrom, baseTo }): EditProposal => {
    const text = after.slice(from, to).join("\n\n");
    const run = (first: number, last: number) => ({
      block: blocks[first]!.id,
      ...(last > first ? { lastBlock: blocks[last]!.id } : {}),
    });
    if (baseTo > baseFrom)
      return to > from
        ? { action: "replace", ...run(baseFrom, baseTo - 1), text }
        : { action: "delete", ...run(baseFrom, baseTo - 1) };
    if (baseFrom > 0)
      return {
        action: "insert_after",
        ...run(baseFrom - 1, baseFrom - 1),
        text,
      };
    if (blocks.length) return { action: "insert_before", ...run(0, 0), text };
    return { action: "append", text };
  });
}
