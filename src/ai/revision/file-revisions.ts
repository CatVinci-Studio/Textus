import { useSyncExternalStore } from "react";
import { ai } from "../../platform/ipc";
import {
  getUiState,
  updateUiState,
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
interface IncomingRevision {
  /** Its changes' ids, in its conversation's record. */
  ids: string[];
  /** The file as the change found it, and as the change leaves it. */
  before: string;
  after: string;
  /** The file read otherwise when it opened: left out, listed in the
   *  conversation's card. */
  conflict?: boolean;
}

interface FileRevisions {
  version: 1;
  incoming: IncomingRevision[];
  /** Made by Textus AI, waiting to be kept. */
  created?: boolean;
  /** Its text before Textus AI wrote straight in. */
  base?: string;
}

/** Each file's store is its proposals' path, marked apart. */
const storeOf = (path: string) => `${path}#ai-changes`;

export async function readFileRevisions(
  path: string,
): Promise<FileRevisions | null> {
  return storedRevisions(path).catch(() => null);
}

/** What is kept for `path`, null for none; a store that can't be read
 *  rejects, so nothing is written over what it holds. */
async function storedRevisions(path: string): Promise<FileRevisions | null> {
  const value = (await ai.keptProposalsRead(
    storeOf(path),
    null,
  )) as Partial<FileRevisions> | null;
  if (!value || value.version !== 1 || !Array.isArray(value.incoming))
    return null;
  return value as FileRevisions;
}

async function writeFileRevisions(
  path: string,
  value: FileRevisions | null,
): Promise<void> {
  const empty =
    !value ||
    (!value.incoming.length && !value.created && value.base === undefined);
  await ai
    .keptProposalsWrite(storeOf(path), null, empty ? null : value, [])
    .catch(() => undefined);
}

/** Each file's changes to its store, one after another: two at once read
 *  the same store and the second's write undid the first's. */
const queues = new Map<string, Promise<unknown>>();

/**
 * Changes `path`'s store by `change` (given what is kept, or a fresh
 * one), after any change to it still going; null clears it, undefined
 * leaves it. Then the file's marks are counted again from what is kept,
 * and, when it changed, its editor is told.
 */
export function updateFileRevisions(
  path: string,
  change: (kept: FileRevisions) => FileRevisions | null | undefined,
): Promise<void> {
  const next = (queues.get(path) ?? Promise.resolve()).then(async () => {
    const kept = (await storedRevisions(path)) ?? {
      version: 1 as const,
      incoming: [],
    };
    const after = change(kept);
    if (after !== undefined) await writeFileRevisions(path, after);
    await recount(path, after === undefined ? kept : after);
    // Told only of a change: its editor reads it again when told.
    if (after !== undefined)
      window.dispatchEvent(
        new CustomEvent(FILE_REVISIONS_EVENT, { detail: path }),
      );
  });
  const settled = next.catch(() => undefined);
  queues.set(path, settled);
  void settled.then(() => {
    if (queues.get(path) === settled) queues.delete(path);
  });
  return settled;
}

/** The file's marks from what is kept: its revisions in its editor's
 *  store and those still to place, a file made to keep, a text before. */
async function recount(path: string, kept: FileRevisions | null) {
  const placed = (await ai.keptProposalsRead(path, null).catch(() => null)) as {
    proposals?: unknown[];
  } | null;
  const waiting = (kept?.incoming ?? [])
    .filter((r) => !r.conflict)
    .reduce((n, r) => n + placesChanged(r.before, r.after), 0);
  setAiFileMark(path, {
    pending: (placed?.proposals?.length ?? 0) + waiting,
    created: !!kept?.created,
    changed: kept?.base !== undefined,
  });
}

/** Another window changed what waits in `path`: counted again here, and
 *  its editor told. */
export async function revisionsArrived(path: string): Promise<void> {
  await proposalsKept(path);
  window.dispatchEvent(new CustomEvent(FILE_REVISIONS_EVENT, { detail: path }));
}

/** The editor wrote its kept proposals: the count follows them. */
export function proposalsKept(path: string): Promise<void> {
  return updateFileRevisions(path, () => undefined);
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

/** What Textus AI left in `path`, as the tree and its tab show it; kept
 *  for every window, each changing only its own file's. */
function setAiFileMark(path: string, patch: AiFileMark): void {
  const next = { ...marks[path], ...patch };
  if (!next.pending) delete next.pending;
  if (!next.created) delete next.created;
  if (!next.changed) delete next.changed;
  const was = JSON.stringify(marks[path] ?? {});
  if (JSON.stringify(next) === was) return;
  marks = { ...marks };
  if (Object.keys(next).length) marks[path] = next;
  else delete marks[path];
  const mine = marks[path];
  updateUiState("aiFileMarks", (live) => {
    const all = { ...(live && typeof live === "object" ? live : {}) } as Record<
      string,
      AiFileMark
    >;
    if (mine) all[path] = mine;
    else delete all[path];
    return all;
  });
  for (const listener of listeners) listener();
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
export function keepAsRevisions(change: {
  file: string;
  id: string;
  before: string;
  after: string;
}): Promise<void> {
  return updateFileRevisions(change.file, (kept) => {
    const open = kept.incoming.find((r) => !r.conflict);
    if (open) {
      open.ids.push(change.id);
      open.after = change.after;
    } else
      kept.incoming.push({
        ids: [change.id],
        before: change.before,
        after: change.after,
      });
    return kept;
  });
}

/** A file Textus AI made, waiting to be kept. */
export function keepAsCreated(file: string): Promise<void> {
  return updateFileRevisions(file, (kept) => ({ ...kept, created: true }));
}

/** A file Textus AI made, kept by the writer or gone to the Trash: no
 *  longer waiting. */
export function forgetCreated(file: string): Promise<void> {
  return updateFileRevisions(file, (kept) => {
    delete kept.created;
    return kept;
  });
}

/** A change that met the writer's own edits, let go of: the card no
 *  longer lists it, nor does Textus AI hear of it. */
export function dismissConflicts(file: string): Promise<void> {
  return updateFileRevisions(file, (kept) => ({
    ...kept,
    incoming: kept.incoming.filter((r) => !r.conflict),
  }));
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
