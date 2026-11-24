// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import en from "../i18n/locales/en";
import { fs } from "../platform/ipc";
import { showChoice } from "../engine/controls/app-dialog";
import { trashFromTree } from "./tree-shared";
import { TreeSelection } from "./tree-selection";
import { useTreeTransfer } from "./useTreeTransfer";
import type { FileStep } from "./file-undo";

vi.mock("../platform/ipc", () => ({
  fs: {
    fileMtimeMs: vi.fn(),
    moveEntry: vi.fn(),
    copyEntry: vi.fn(),
    listDir: vi.fn(async () => []),
  },
}));
vi.mock("../engine/controls/app-dialog", () => ({
  showChoice: vi.fn(),
  showMessage: vi.fn(),
}));
vi.mock("../engine/controls/notices", () => ({ showNotice: vi.fn() }));
vi.mock("./move-links", () => ({
  updateLinksAfterMove: vi.fn(async () => []),
}));
vi.mock("./tree-shared", async (real) => ({
  ...(await real<typeof import("./tree-shared")>()),
  trashFromTree: vi.fn(async () => ({ places: ["bin:1"], error: undefined })),
}));

/** What is on disk: a path's time, or none. */
let disk: Record<string, number> = {};
const recorded: FileStep[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  disk = { "/n/plan.md": 1, "/n/sub/plan.md": 2 };
  vi.mocked(fs.fileMtimeMs).mockImplementation(async (p) => disk[p] ?? null);
  vi.mocked(fs.moveEntry).mockImplementation(
    async (path, into, _name, keepBoth) =>
      `${into}/${keepBoth ? "plan 2.md" : path.split("/").pop()}`,
  );
  vi.mocked(fs.copyEntry).mockImplementation(async (path, into, naming) =>
    typeof naming === "object"
      ? `${into}/${naming.beside.replace("{name}", "plan")}.md`
      : `${into}/${naming === "numbered" ? "plan 2.md" : path.split("/").pop()}`,
  );
});

function transfer() {
  const { result } = renderHook(() =>
    useTreeTransfer({
      folder: "/n",
      t: en,
      reload: () => {},
      onEntryMoved: () => {},
      fileUndo: {
        record: (step) => void recorded.push(step),
        show: () => {},
        rowBeside: () => null,
        act: { undo: () => false, redo: () => false },
      },
      selection: new TreeSelection(),
    }),
  );
  return result.current.transfer;
}

const plan = [{ path: "/n/plan.md", isDir: false }];

it("a copy beside itself is named as a file manager names one, without asking", async () => {
  await transfer()(plan, "/n", "copy");
  expect(showChoice).not.toHaveBeenCalled();
  expect(fs.copyEntry).toHaveBeenCalledWith("/n/plan.md", "/n", {
    beside: "{name} copy",
  });
  // Duplicate: each beside itself.
  await transfer()(plan, null, "copy");
  expect(fs.copyEntry).toHaveBeenLastCalledWith("/n/plan.md", "/n", {
    beside: "{name} copy",
  });
});

it("a name taken where it goes asks: Keep Both numbers it, Replace trashes the old one first, Cancel does nothing", async () => {
  vi.mocked(showChoice).mockResolvedValueOnce("alt");
  await transfer()(plan, "/n/sub", "move");
  expect(fs.moveEntry).toHaveBeenLastCalledWith(
    "/n/plan.md",
    "/n/sub",
    undefined,
    true,
  );

  vi.mocked(showChoice).mockResolvedValueOnce("ok");
  await transfer()(plan, "/n/sub", "move");
  expect(trashFromTree).toHaveBeenCalledWith(
    ["/n/sub/plan.md"],
    "/n",
    expect.any(Function),
  );
  expect(fs.moveEntry).toHaveBeenLastCalledWith(
    "/n/plan.md",
    "/n/sub",
    undefined,
    false,
  );
  // One step to undo: the old one back from the Trash after the move back.
  const replaced = recorded.at(-1)!;
  expect(
    replaced.kind === "steps" && replaced.steps.map((s) => s.kind),
  ).toEqual(["trashed", "moved"]);

  vi.mocked(fs.moveEntry).mockClear();
  vi.mocked(showChoice).mockResolvedValueOnce(null);
  await transfer()(plan, "/n/sub", "copy");
  expect(fs.copyEntry).not.toHaveBeenCalled();
  expect(recorded).toHaveLength(2);
});

it("a copy elsewhere keeps its name; a cut pasted where it is stays", async () => {
  await transfer()(plan, "/n/other", "copy");
  expect(fs.copyEntry).toHaveBeenCalledWith("/n/plan.md", "/n/other", "own");
  await transfer()(plan, "/n", "move");
  expect(fs.moveEntry).not.toHaveBeenCalled();
});

it("Replace keeps the old entry as what it was: a folder a file replaced comes back a folder", async () => {
  vi.mocked(fs.listDir).mockResolvedValueOnce([
    { name: "plan.md", path: "/n/sub/plan.md", is_dir: true } as never,
  ]);
  vi.mocked(showChoice).mockResolvedValueOnce("ok");
  await transfer()(plan, "/n/sub", "move");
  const replaced = recorded.at(-1)!;
  const trashed = replaced.kind === "steps" ? replaced.steps[0] : null;
  expect(trashed?.kind === "trashed" && trashed.trashed[0]).toEqual({
    path: "/n/sub/plan.md",
    isDir: true,
    place: "bin:1",
  });
});

it("a Windows folder's paths are joined with its own separator", async () => {
  disk = { "C:\\n\\plan.md": 1 };
  vi.mocked(fs.moveEntry).mockResolvedValueOnce("C:\\n\\sub\\plan.md");
  await transfer()(
    [{ path: "C:\\n\\plan.md", isDir: false }],
    "C:\\n\\sub",
    "move",
  );
  expect(fs.fileMtimeMs).toHaveBeenCalledWith("C:\\n\\sub\\plan.md");
});
