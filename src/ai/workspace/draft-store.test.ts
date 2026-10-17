import { describe, expect, it } from "vitest";
import { decodeWorkspaceSnapshot, rebaseRestoredDraft } from "./draft-store";

const snapshot = {
  schemaVersion: 1,
  documentId: "doc",
  documentPath: null,
  status: "running",
  updatedAt: 1,
  draft: {
    id: "task",
    documentId: "doc",
    sessionId: "session",
    baseRevision: 42,
    baseMarkdown: "Original.",
    selection: { from: 1, to: 1 },
    operations: [
      { callId: "a", proposal: { action: "append" as const, text: "New." } },
    ],
  },
};
describe("workspace recovery", () => {
  it("marks an unfinished task interrupted without restarting it", () => {
    const restored = decodeWorkspaceSnapshot(snapshot);
    expect(restored?.status).toBe("interrupted");
    expect(restored?.draft.operations).toHaveLength(1);
  });
  it("rejects corrupt and future schemas, wrong identities and malformed operations", () => {
    for (const value of [
      null,
      {},
      { ...snapshot, schemaVersion: 2 },
      { ...snapshot, documentId: "another" },
      { ...snapshot, draft: { ...snapshot.draft, operations: [{}] } },
    ])
      expect(decodeWorkspaceSnapshot(value)).toBeNull();
  });
  it("only rebases a restored revision when the exact base document still matches", () => {
    expect(
      rebaseRestoredDraft(snapshot.draft, "Original.", 7)?.baseRevision,
    ).toBe(7);
    expect(
      rebaseRestoredDraft(snapshot.draft, "Manual edit.", 7),
    ).toMatchObject({ conflicted: true, baseRevision: 42 });
  });
  it("preserves a conflicted base snapshot through a second restart", () => {
    const first = rebaseRestoredDraft(
      snapshot.draft,
      "Manually saved document.",
      0,
    );
    const saved = JSON.parse(JSON.stringify({ ...snapshot, draft: first }));
    const second = decodeWorkspaceSnapshot(saved);
    expect(second?.draft.operations).toHaveLength(1);
    expect(second?.draft.baseMarkdown).toBe("Original.");
    expect(second?.draft).toMatchObject({ conflicted: true, baseRevision: 42 });
  });
});
