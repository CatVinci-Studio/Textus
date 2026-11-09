import { useSyncExternalStore } from "react";
import { ai } from "../../platform/ipc";
import { FILE_WRITTEN_EVENT } from "../../utils/events";
import type { AgentTurn } from "../types";

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

const marked = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = new Set();

function publish() {
  snapshot = new Set(marked);
  for (const listener of listeners) listener();
}

/** The files Textus AI changed this session, until undone. */
export function useChangedFiles(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

/** Files written or put back: open tabs of them read the disk again, and
 *  those now changed are marked. */
export function filesChanged(files: { file: string; applied: boolean }[]) {
  for (const { file, applied } of files) {
    if (applied) marked.add(file);
    else marked.delete(file);
    window.dispatchEvent(new CustomEvent(FILE_WRITTEN_EVENT, { detail: file }));
  }
  publish();
}

/** After a reply: the files its changes wrote. */
export async function afterFileChanges(
  conversation: string,
  turns: readonly AgentTurn[],
) {
  const ids = turns.flatMap((t) => changeOf(t)?.change ?? []);
  if (ids.length === 0) return;
  try {
    filesChanged(await ai.fileChanges(conversation, ids));
  } catch {
    // The card says what it can; the marks are a convenience.
  }
}
