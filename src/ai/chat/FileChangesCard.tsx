import { openDocument } from "../../utils/open-document";
import { useEffect, useState, type CSSProperties } from "react";
import { ai } from "../../platform/ipc";
import type { FileChange_Serialize as FileChange } from "../../platform/bindings/ai-project";
import { filesChanged, type FileChangeCall } from "./file-changes";
import {
  FILE_REVISIONS_EVENT,
  dismissConflicts,
  forgetCreated,
  readFileRevisions,
  useAiFileMarks,
} from "../revision/file-revisions";
import type { AiFileMark } from "../../storage/ui-state";
import { useWindowEvent } from "../../utils/hooks/useWindowEvent";

interface FileChangesLabels {
  filesChangedTitle: string;
  filesKeptTitle: string;
  filesNew: string;
  filesUndo: string;
  filesApply: string;
  filesWaiting: (n: number) => string;
  filesConflict: string;
  filesCreated: string;
  filesKeep: string;
  filesDiscard: string;
  filesDismiss: string;
}

/**
 * A reply's changes to the folder's files: each file, which opens on a
 * click. Written straight in, one button takes the reply's changes off the
 * disk or puts them back. As revisions, each file says what waits in it -
 * its revisions, a change that met other edits (never dropped), a file
 * made to keep or discard - and the revisions are decided in the file.
 */
export function FileChangesCard({
  run,
  conversation,
  reveal,
  style,
  labels,
}: {
  run: FileChangeCall[];
  conversation: string;
  reveal: boolean;
  style: CSSProperties | undefined;
  labels: FileChangesLabels;
}) {
  const ids = run.map((c) => c.change);
  const key = ids.join(",");
  const [changes, setChanges] = useState<FileChange[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    ai.fileChanges(conversation, key.split(",")).then(
      (kept) => live && setChanges(kept),
      () => live && setChanges([]),
    );
    return () => {
      live = false;
    };
  }, [conversation, key]);
  const marks = useAiFileMarks();
  const conflicts = useConflicts(changes);
  if (!changes || changes.length === 0) return null;
  // Made as revisions: what waits is decided in each file, never undone
  // from here (Undo would send a file kept since to the Trash).
  const revisions = changes.some((c) => c.revision);
  const on = changes.every((c) => c.applied);
  // One row a file, however many changes it had.
  const files = [...new Map(changes.map((c) => [c.file, c])).values()];
  const made = new Set(
    changes.filter((c) => c.before === null).map((c) => c.file),
  );

  async function toggle() {
    try {
      const [now, refused] = await ai.setFileChanges(conversation, ids, !on);
      setChanges(now);
      setProblems(refused);
      filesChanged(now);
    } catch (err) {
      setProblems([String(err)]);
    }
  }

  /** A file it made, kept as the writer's or sent to the Trash. */
  async function decideMade(file: string, keep: boolean) {
    if (!keep) {
      const made = changes!.filter((c) => c.file === file).map((c) => c.id);
      const [now, refused] = await ai.setFileChanges(conversation, made, false);
      setChanges(
        (was) => was && was.map((c) => now.find((n) => n.id === c.id) ?? c),
      );
      setProblems(refused);
      if (refused.length) return;
    }
    await forgetCreated(file);
  }

  return (
    <div
      className={`agent-comment agent-file-changes${reveal ? " turn-reveal" : ""}`}
      style={style}
    >
      <div className="agent-proposal-head">
        <span className="agent-proposal-title">
          {on ? labels.filesChangedTitle : labels.filesKeptTitle}
          <span className="agent-proposal-kind"> · {files.length}</span>
        </span>
      </div>
      <ul className="agent-file-changes-rows">
        {files.map((c) => (
          <li key={c.file}>
            <button
              type="button"
              className="agent-file-changes-path"
              disabled={!c.applied && c.before === null}
              onClick={() => openDocument(c.file)}
            >
              {c.path}
            </button>
            {revisions ? (
              <FileWaiting
                waiting={marks[c.file]}
                conflict={conflicts.has(c.file)}
                labels={labels}
                onMade={(keep) => void decideMade(c.file, keep)}
                onDismiss={() => void dismissConflicts(c.file)}
              />
            ) : (
              made.has(c.file) && (
                <span className="agent-proposal-kind">{labels.filesNew}</span>
              )
            )}
          </li>
        ))}
      </ul>
      {problems.map((p) => (
        <div key={p} className="agent-file-changes-problem">
          {p}
        </div>
      ))}
      {!revisions && (
        <div className="agent-file-changes-actions">
          <button type="button" className="tx-button small" onClick={toggle}>
            {on ? labels.filesUndo : labels.filesApply}
          </button>
        </div>
      )}
    </div>
  );
}

/** What waits in one file, after its name. */
function FileWaiting({
  waiting,
  conflict,
  labels,
  onMade,
  onDismiss,
}: {
  waiting: AiFileMark | undefined;
  conflict: boolean;
  labels: FileChangesLabels;
  onMade: (keep: boolean) => void;
  /** The change that met the writer's edits, let go of. */
  onDismiss: () => void;
}) {
  if (conflict)
    return (
      <>
        <span className="agent-file-changes-problem">
          {labels.filesConflict}
        </span>
        <button type="button" className="tx-button small" onClick={onDismiss}>
          {labels.filesDismiss}
        </button>
      </>
    );
  if (waiting?.created)
    return (
      <>
        <span className="agent-proposal-kind">{labels.filesCreated}</span>
        <button
          type="button"
          className="tx-button small"
          onClick={() => onMade(true)}
        >
          {labels.filesKeep}
        </button>
        <button
          type="button"
          className="tx-button small"
          onClick={() => onMade(false)}
        >
          {labels.filesDiscard}
        </button>
      </>
    );
  return waiting?.pending ? (
    <span className="agent-proposal-kind">
      {labels.filesWaiting(waiting.pending)}
    </span>
  ) : null;
}

/** The card's files whose change met other edits, kept in their stores. */
function useConflicts(changes: FileChange[] | null): ReadonlySet<string> {
  const [conflicts, setConflicts] = useState<ReadonlySet<string>>(new Set());
  const files = [...new Set((changes ?? []).map((c) => c.file))].join("\n");
  const [stamp, restamp] = useState(0);
  useWindowEvent(FILE_REVISIONS_EVENT, (e) => {
    if (files.split("\n").includes((e as CustomEvent<string>).detail))
      restamp((n) => n + 1);
  });
  useEffect(() => {
    let live = true;
    const list = files ? files.split("\n") : [];
    void Promise.all(list.map(readFileRevisions)).then((kept) => {
      if (!live) return;
      setConflicts(
        new Set(
          list.filter((_, i) => kept[i]?.incoming.some((r) => r.conflict)),
        ),
      );
    });
    return () => {
      live = false;
    };
  }, [files, stamp]);
  return conflicts;
}
