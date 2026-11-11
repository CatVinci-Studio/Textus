import { useSyncExternalStore } from "react";
import { ai } from "../../platform/ipc";
import { FILE_WRITTEN_EVENT } from "../../utils/events";
import type { AgentTurn } from "../types";
import {
  keepAsCreated,
  keepAsRevisions,
  readFileRevisions,
  updateFileRevisions,
} from "../revision/file-revisions";

/**
 * General mode's changes to the folder's other files (write_file,
 * edit_file): a reply's changes shown as one card under its first, and the
 * files changed marked in the tree and on their tabs while their changes
 * stand.
 */

const FILE_TOOLS = new Set(["write_file", "edit_file"]);

export interface FileChangeCall {
  callId: string;
  /** The change the backend kept, recorded in the call. */
  change: string;
  path: string;
}

function changeOf(turn: AgentTurn): FileChangeCall | null {
  if (turn.kind !== "ToolCall" || !FILE_TOOLS.has(turn.name)) return null;
  try {
    const args = JSON.parse(turn.arguments) as {
      change?: unknown;
      path?: unknown;
    };
    if (typeof args.change !== "string") return null;
    return {
      callId: turn.call_id,
      change: args.change,
      path: typeof args.path === "string" ? args.path : "",
    };
  } catch {
    return null;
  }
}

/** Each reply's file changes under its first change's call; the reply's
 *  other change calls, and those that changed nothing, under an empty
 *  list. */
export function fileRunsOf(
  turns: readonly AgentTurn[],
): Map<string, FileChangeCall[]> {
  const runs = new Map<string, FileChangeCall[]>();
  let first: string | null = null;
  for (const turn of turns) {
    if (turn.kind === "User") first = null;
    if (turn.kind !== "ToolCall" || !FILE_TOOLS.has(turn.name)) continue;
    const change = changeOf(turn);
    if (first === null && change) {
      first = turn.call_id;
      runs.set(first, [change]);
    } else {
      if (first && change) runs.get(first)!.push(change);
      runs.set(turn.call_id, []);
    }
  }
  return runs;
}

/** Each file Textus AI changed this session, and its text before the
 *  first change (null for a file it made). */
const bases = new Map<string, string | null>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = new Set();

function publish() {
  snapshot = new Set(bases.keys());
  for (const listener of listeners) listener();
}

/** Calls `listener` when the files changed, or their texts before, do. */
export function onChangedFiles(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `file`'s text before Textus AI first changed it, or undefined where it
 *  hasn't (or the change was undone). */
export function textBeforeChanges(file: string): string | null | undefined {
  return bases.get(file);
}

/** The file reads as before again: no change of Textus AI's left to show. */
export function changesSettled(file: string) {
  if (bases.delete(file)) publish();
  void keepBase(file, undefined);
}

/** `file`'s text before Textus AI wrote straight in, kept with the file so
 *  its marks outlive a restart; undefined lets it go. */
function keepBase(file: string, base: string | undefined) {
  return updateFileRevisions(file, ({ base: was, ...kept }) => {
    if (was === base) return undefined;
    return base === undefined ? kept : { ...kept, base };
  });
}

/** Its text before, noted as Textus AI first writes straight into it (the
 *  document open, its proposal taken at once). */
export function noteBase(file: string, before: string) {
  if (bases.has(file)) return;
  bases.set(file, before);
  publish();
  void keepBase(file, before);
}

/** A file opened: its text before Textus AI wrote into it, as kept. */
export async function restoreBase(file: string) {
  if (bases.has(file)) return;
  const base = (await readFileRevisions(file))?.base;
  if (base === undefined || bases.has(file)) return;
  bases.set(file, base);
  publish();
}

/** The files Textus AI changed this session, until undone. */
export function useChangedFiles(): ReadonlySet<string> {
  return useSyncExternalStore(onChangedFiles, () => snapshot);
}

/** Where another window must hear of changes made here (the detached chat
 *  tells its editor); none in an editor window. */
let relay:
  | ((
      written: { file: string; applied: boolean; before: string | null }[],
      revised: string[],
    ) => void)
  | null = null;

export function relayFileChanges(to: typeof relay): () => void {
  relay = to;
  return () => {
    if (relay === to) relay = null;
  };
}

/** Files whose revisions changed here, for the window that shows them. */
function revisionsChanged(files: string[]) {
  if (files.length) relay?.([], files);
}

/** Files written or put back: open tabs of them read the disk again, and
 *  those now changed are marked. */
export function filesChanged(
  files: { file: string; applied: boolean; before: string | null }[],
) {
  relay?.(files, []);
  for (const { file, applied, before } of files) {
    // The earliest text before: a reply's later changes build on it.
    if (applied && !bases.has(file)) {
      bases.set(file, before);
      if (before != null) void keepBase(file, before);
    }
    // Undone: its marks go, here and in the store (known or not yet).
    if (!applied) {
      bases.delete(file);
      void keepBase(file, undefined);
    }
    window.dispatchEvent(new CustomEvent(FILE_WRITTEN_EVENT, { detail: file }));
  }
  publish();
}

/** After a reply: the files its changes wrote, and with changes as
 *  revisions, those kept for their files and the files it made. */
export async function afterFileChanges(
  conversation: string,
  turns: readonly AgentTurn[],
  revisions: boolean,
) {
  const ids = turns.flatMap((t) => changeOf(t)?.change ?? []);
  if (ids.length === 0) return;
  try {
    const changes = await ai.fileChanges(conversation, ids);
    const revised: string[] = [];
    for (const { id, file, before, after, applied } of changes) {
      if (!applied && before != null) {
        await keepAsRevisions({ id, file, before, after });
        revised.push(file);
      } else if (revisions && applied && before == null) {
        await keepAsCreated(file);
        revised.push(file);
      }
    }
    revisionsChanged(revised);
    filesChanged(
      changes.filter((c) => c.applied && !(revisions && c.before == null)),
    );
  } catch {
    // The card says what it can; the marks are a convenience.
  }
}
