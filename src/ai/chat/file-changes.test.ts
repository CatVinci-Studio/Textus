// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { FILE_CREATED_EVENT } from "../../utils/events";
import { afterFileChanges } from "./file-changes";

vi.mock("../../platform/ipc", () => ({
  ai: {
    fileChanges: async () => [
      { id: "c1", file: "/f/new.md", before: null, after: "x", applied: true },
      { id: "c2", file: "/f/old.md", before: "a", after: "b", applied: true },
    ],
  },
}));
vi.mock("../revision/file-revisions", () => ({
  keepAsCreated: async () => {},
  keepAsRevisions: async () => {},
  readFileRevisions: async () => ({}),
  updateFileRevisions: async () => {},
}));

describe("files Textus AI wrote", () => {
  it("tell the window (and plugins) of the ones it made", async () => {
    const made: string[] = [];
    const heard = (e: Event) => made.push((e as CustomEvent<string>).detail);
    window.addEventListener(FILE_CREATED_EVENT, heard);
    const turns = ["c1", "c2"].map((change, i) => ({
      kind: "ToolCall",
      name: "write_file",
      call_id: `k${i}`,
      arguments: JSON.stringify({ change, path: "x" }),
    }));
    await afterFileChanges("conv", turns as never, false);
    window.removeEventListener(FILE_CREATED_EVENT, heard);
    expect(made).toEqual(["/f/new.md"]);
  });
});
