import { useEffect, useState, type CSSProperties } from "react";
import { ai } from "../../platform/ipc";
import { OPEN_FILE_IN_TAB_EVENT } from "../../utils/events";
import type { FileChange_Serialize as FileChange } from "../../platform/bindings/ai-project";
import { filesChanged, type FileChangeCall } from "./file-changes";

export interface FileChangesLabels {
  filesChangedTitle: string;
  filesKeptTitle: string;
  filesNew: string;
  filesUndo: string;
  filesApply: string;
}

/**
 * A reply's changes to the folder's files: each file, which opens on a
 * click, and one button that takes the reply's changes off the disk or
 * puts them on (redo, or applying them where the user approves first).
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
  if (!changes || changes.length === 0) return null;
  const on = changes.every((c) => c.applied);
  // One row a file, however many changes it had.
  const files = [...new Map(changes.map((c) => [c.file, c])).values()];
  const made = new Set(
    changes.filter((c) => c.before === null).map((c) => c.file),
  );

  async function toggle() {
    const [now, refused] = await ai.setFileChanges(conversation, ids, !on);
    setChanges(now);
    setProblems(refused);
    filesChanged(now.map(({ file, applied }) => ({ file, applied })));
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
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent(OPEN_FILE_IN_TAB_EVENT, { detail: c.file }),
                )
              }
            >
              {c.path}
            </button>
            {made.has(c.file) && (
              <span className="agent-proposal-kind">{labels.filesNew}</span>
            )}
          </li>
        ))}
      </ul>
      {problems.map((p) => (
        <div key={p} className="agent-file-changes-problem">
          {p}
        </div>
      ))}
      <div className="agent-file-changes-actions">
        <button type="button" className="tx-button small" onClick={toggle}>
          {on ? labels.filesUndo : labels.filesApply}
        </button>
      </div>
    </div>
  );
}
