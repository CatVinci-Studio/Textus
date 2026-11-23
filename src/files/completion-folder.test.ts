import { afterEach, expect, it, vi } from "vitest";
import { completionSources } from "../editor/completion/sources";
import { fs } from "../platform/ipc";
import { setWindowFolderSource } from "../platform/window-folder";
import { registerNoteCompletion } from "./note-completion";
import { registerPathCompletion } from "./path-completion";

vi.mock("./link-style", async (real) => ({
  ...(await real<typeof import("./link-style")>()),
  linkStyleAt: async () => ({ wiki: true, format: "shortest" }),
}));

let folder: string | null = null;
function openFolder(next: string | null) {
  folder = next;
  setWindowFolderSource(() => folder);
}

const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  openFolder(null);
  vi.restoreAllMocks();
});

/** The labels source `id` lists for `text` typed in the document `path`. */
async function listed(id: string, text: string, path: string | null) {
  const source = completionSources().find((s) => s.id === id)!;
  const match = source.pattern.exec(text)!;
  const answer = await source.provide(
    {
      text,
      match: match[0],
      query: match.at(-1) ?? "",
      after: "",
      inMath: false,
      path,
    },
    new AbortController().signal,
  );
  return answer && "items" in answer
    ? answer.items.map((item) => item.label)
    : answer;
}

it("[[ and a path list the folder open now, straight after another", async () => {
  vi.spyOn(fs, "indexFolder").mockImplementation(async (root) => ({
    files: [
      { path: `${root}/${root.slice(1)}.md`, rel: `${root.slice(1)}.md` },
    ],
    truncated: false,
  }));
  stops.push(
    registerNoteCompletion(() => "Notes"),
    registerPathCompletion({ image: () => "Images", link: () => "Files" }),
  );
  openFolder("/one");
  expect(await listed("textus.notes", "[[", null)).toEqual(["one"]);
  expect(await listed("textus.paths.link", "[a](", "/one/doc.md")).toEqual([
    "one.md",
  ]);
  openFolder("/two");
  expect(await listed("textus.notes", "[[", null)).toEqual(["two"]);
  expect(await listed("textus.paths.link", "[a](", "/two/doc.md")).toEqual([
    "two.md",
  ]);
  openFolder(null);
  expect(await listed("textus.notes", "[[", null)).toBeNull();
  expect(await listed("textus.paths.link", "[a](", "/two/doc.md")).toBeNull();
});
