// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const { said } = vi.hoisted(() => ({ said: vi.fn() }));
vi.mock("../../platform/ipc", () => ({
  ai: {
    keptProposalsRead: () => Promise.resolve(null),
    keptProposalsWrite: () => Promise.reject(new Error("disk full")),
  },
}));
vi.mock("../../engine/controls/notices", () => ({ showNotice: said }));

import { updateFileRevisions } from "./file-revisions";

describe("changes waiting in a file", () => {
  it("that couldn't be kept on disk are said once, not lost in silence", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const add = () =>
      updateFileRevisions("/notes/a.md", (kept) => ({
        ...kept,
        created: true,
      }));
    await add();
    await add();
    expect(said).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
