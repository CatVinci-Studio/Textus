// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Set<string>();
const dirs: Record<string, { name: string; path: string; is_dir: boolean }[]> =
  {};
vi.mock("../platform/ipc", () => ({
  fs: {
    fileMtimeMs: async (p: string) => (files.has(p) ? 1 : null),
    listDir: async (p: string) => dirs[p] ?? [],
  },
}));

const { openingDocuments, withProjectTabs } = await import("./start-project");
const { setUiState } = await import("../storage/ui-state");

const entry = (name: string, is_dir = false) => ({
  name,
  path: `/p/${name}`,
  is_dir,
});

beforeEach(() => {
  files.clear();
  for (const k of Object.keys(dirs)) delete dirs[k];
  setUiState("projectTabs", {});
});

describe("what a project opens with from the start page", () => {
  it("is the tabs it was left with, the one in front last", async () => {
    setUiState(
      "projectTabs",
      withProjectTabs(
        {},
        "/p/",
        ["/p/a.md", "/q/x.md", "/p/b.md", "/p/gone.md"],
        "/p/a.md",
      ),
    );
    files.add("/p/a.md").add("/p/b.md");
    expect(await openingDocuments("/p", ["/p/c.md"])).toEqual([
      "/p/b.md",
      "/p/a.md",
    ]);
  });

  it("else the document last opened in it, else its README", async () => {
    dirs["/p"] = [entry("b.md"), entry("Readme.md")];
    expect(await openingDocuments("/p", ["/q/x.md", "/p/n/c.md"])).toEqual([
      "/p/n/c.md",
    ]);
    expect(await openingDocuments("/p", [])).toEqual(["/p/Readme.md"]);
  });

  it("else nothing: no note is picked for the user", async () => {
    dirs["/p"] = [entry("Week 2.md"), entry("docs", true)];
    expect(await openingDocuments("/p", [])).toEqual([]);
  });

  it("keeps a project's tabs only while some are in it", () => {
    const kept = withProjectTabs({}, "/p", ["/p/a.md"], "/p/a.md");
    expect(withProjectTabs(kept, "/p", ["/q/x.md"], "/q/x.md")).toBe(kept);
  });
});
