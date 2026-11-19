import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => new Map<string, string>());
const changed = vi.hoisted(() => vi.fn());
vi.mock("../../platform/ipc-files", () => ({
  fs: {
    readTextFile: async (path: string) => {
      const text = disk.get(path);
      if (text === undefined) throw new Error("missing");
      return text;
    },
  },
}));
vi.mock("../chat/file-changes", () => ({ filesChanged: changed }));
vi.mock("../../plugins/app-bridge", () => ({ getWindowAccess: () => null }));
const open = vi.hoisted(() => new Map<string, string>());
vi.mock("../../registry/open-documents", () => ({
  openDocumentAt: (path: string) =>
    open.has(path) ? { text: () => open.get(path)! } : null,
}));

const { followEdit } = await import("./agent-files");

const settle = () => new Promise((done) => setTimeout(done, 0));

describe("an agent's edits written to disk itself", () => {
  beforeEach(() => {
    disk.clear();
    open.clear();
    changed.mockReset();
  });

  it("are read again, unmarked, once the step changed them", async () => {
    const edits = new Map();
    disk.set("/w/a.md", "old");
    followEdit(edits, "/w", {
      toolCallId: "e1",
      kind: "edit",
      status: "pending",
      locations: [{ path: "/w/a.md" }],
    });
    await settle();
    disk.set("/w/a.md", "new");
    followEdit(edits, "/w", { toolCallId: "e1", status: "completed" });
    await settle();
    expect(changed).toHaveBeenCalledWith([{ file: "/w/a.md", applied: true }]);
  });

  it("leave reads, unchanged files and places outside the folder alone", async () => {
    const edits = new Map();
    disk.set("/w/a.md", "same");
    disk.set("/elsewhere/b.md", "b");
    followEdit(edits, "/w", {
      toolCallId: "r1",
      kind: "read",
      locations: [{ path: "/w/a.md" }],
    });
    followEdit(edits, "/w", {
      toolCallId: "e2",
      kind: "edit",
      rawInput: { file_path: "/w/a.md" },
    });
    followEdit(edits, "/w", {
      toolCallId: "e3",
      kind: "edit",
      locations: [{ path: "/elsewhere/b.md" }],
    });
    await settle();
    disk.set("/elsewhere/b.md", "changed");
    for (const id of ["r1", "e2", "e3"])
      followEdit(edits, "/w", { toolCallId: id, status: "completed" });
    await settle();
    expect(changed).not.toHaveBeenCalled();
  });

  it("leave an open file alone when only its unsaved typing differs", async () => {
    const edits = new Map();
    disk.set("/w/a.md", "saved");
    open.set("/w/a.md", "saved and typed");
    followEdit(edits, "/w", {
      toolCallId: "e4",
      kind: "edit",
      locations: [{ path: "/w/a.md" }],
    });
    await settle();
    followEdit(edits, "/w", { toolCallId: "e4", status: "failed" });
    await settle();
    expect(changed).not.toHaveBeenCalled();
  });
});
