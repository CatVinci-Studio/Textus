// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import en from "../i18n/locales/en";
import { useNewEntry } from "./useNewEntry";
import type { FileStep } from "./file-undo";

vi.mock("../platform/ipc", () => ({
  fs: {
    createDocument: vi.fn(async () => ({ path: "/n/a/b.md", made: "/n/a" })),
    createFolder: vi.fn(),
    fileMtimeMs: vi.fn(async () => 1),
    listDir: vi.fn(async (dir: string) =>
      dir === "/n/a"
        ? [{ name: "b.md", path: "/n/a/b.md", is_dir: false, modified_ms: 1 }]
        : [],
    ),
  },
}));

it("a name with a slash is undone whole: the folder it made, with the document in it", async () => {
  const recorded: FileStep[] = [];
  const opened: string[] = [];
  const { result } = renderHook(() =>
    useNewEntry(
      en,
      () => {},
      (p) => void opened.push(p),
      {
        record: (step: FileStep) => void recorded.push(step),
        show: () => {},
        rowBeside: () => null,
        act: { undo: () => false, redo: () => false },
      },
    ),
  );
  act(() => result.current.setDraft({ dir: "/n", kind: "document" }));
  await act(() => result.current.finishDraft("a/b", true));
  expect(recorded).toEqual([
    { kind: "made", made: [{ path: "/n/a", isDir: true, stamp: "/b.md\t1" }] },
  ]);
  expect(opened).toEqual(["/n/a/b.md"]);
});
