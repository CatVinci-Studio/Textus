import type { DocumentDraft } from "./document-draft";
import { parseProposal } from "../chat/proposal";
import { workspaceDrafts, type WorkspaceSnapshot } from "../../platform/ipc";
import { trackWrite } from "../../storage/pending-writes";

export function decodeWorkspaceSnapshot(
  value: unknown,
): WorkspaceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const s = value as WorkspaceSnapshot;
  const d = s.draft;
  if (
    s.schemaVersion !== 1 ||
    typeof s.documentId !== "string" ||
    !s.documentId ||
    (s.documentPath !== null && typeof s.documentPath !== "string") ||
    !Number.isFinite(s.updatedAt) ||
    !["running", "review", "interrupted"].includes(s.status) ||
    !d ||
    d.documentId !== s.documentId ||
    typeof d.id !== "string" ||
    typeof d.sessionId !== "string" ||
    typeof d.baseMarkdown !== "string" ||
    !Number.isSafeInteger(d.baseRevision) ||
    d.baseRevision < -1 ||
    (d.conflicted !== undefined && typeof d.conflicted !== "boolean") ||
    !d.selection ||
    !Number.isSafeInteger(d.selection.from) ||
    !Number.isSafeInteger(d.selection.to) ||
    d.selection.from < 0 ||
    d.selection.to < d.selection.from ||
    !Array.isArray(d.operations)
  )
    return null;
  const ids = new Set<string>();
  for (const op of d.operations) {
    if (
      !op ||
      typeof op.callId !== "string" ||
      ids.has(op.callId) ||
      !parseProposal(JSON.stringify(op.proposal))
    )
      return null;
    ids.add(op.callId);
  }
  return {
    ...s,
    draft:
      d.baseRevision === -1 ? { ...d, baseRevision: 0, conflicted: true } : d,
    status: s.status === "running" ? "interrupted" : s.status,
  };
}

export function rebaseRestoredDraft(
  draft: DocumentDraft,
  markdown: string,
  revision: number,
): DocumentDraft {
  return !draft.conflicted && draft.baseMarkdown === markdown
    ? { ...draft, baseRevision: revision }
    : { ...draft, conflicted: true };
}

const writes = new Map<string, Promise<void>>();
/** Serialize saves/deletes per document so a slow earlier save cannot resurrect a cleared draft. */
export function persistWorkspace(
  snapshot: WorkspaceSnapshot | null,
  documentId: string,
): Promise<void> {
  const previous = writes.get(documentId) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() =>
      snapshot
        ? workspaceDrafts.save(snapshot)
        : workspaceDrafts.clear(documentId),
    );
  writes.set(documentId, next);
  const clean = () => {
    if (writes.get(documentId) === next) writes.delete(documentId);
  };
  next.then(clean, clean);
  return trackWrite(next);
}

export async function loadWorkspace(
  documentId: string,
): Promise<WorkspaceSnapshot | null> {
  return decodeWorkspaceSnapshot(await workspaceDrafts.load(documentId));
}
