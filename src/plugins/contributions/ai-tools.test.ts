import { describe, expect, it, vi } from "vitest";

vi.mock("../store/plugin-records", async (importOriginal) => {
  const real = await importOriginal<typeof import("../store/plugin-records")>();
  return {
    ...real,
    pluginsSnapshot: () => ({
      allOn: true,
      records: [
        {
          id: "catvinci.tasks",
          status: "on",
          granted: ["ai.tools"],
          manifest: {
            l10n: { en: { listTasks: "List the tasks in the open folder." } },
            contributes: {
              aiTools: [
                {
                  name: "list_tasks",
                  description: "%listTasks%",
                  parameters: { type: "object" },
                },
              ],
            },
          },
        },
        {
          id: "acme.ungranted",
          status: "on",
          granted: [],
          manifest: {
            l10n: {},
            contributes: {
              aiTools: [{ name: "secret", description: "x", parameters: {} }],
            },
          },
        },
      ],
    }),
  };
});

import { offered } from "./ai-tools";

describe("plugin AI tools", () => {
  it("offers only a granted plugin's tools, with the translated description, not its key", () => {
    expect(offered()).toEqual([
      expect.objectContaining({
        plugin: "catvinci.tasks",
        name: "list_tasks",
        description: "List the tasks in the open folder.",
      }),
    ]);
  });
});

vi.mock("../app-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../app-bridge")>()),
  getWindowAccess: () => ({ rootPath: () => "/v" }),
}));
vi.mock("../workspace/metadata-cache", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../workspace/metadata-cache")>();
  const doc = (rel: string, more: object) => ({
    path: `/v/${rel}`,
    rel,
    title: rel.replace(/\.md$/, ""),
    tags: [],
    tasks: [],
    links: [],
    ...more,
  });
  const task = (
    rel: string,
    line: number,
    text: string,
    due: string | null,
  ) => ({ text, done: false, due, tags: [], path: `/v/${rel}`, line });
  const documents = [
    doc("Plan.md", {
      tags: ["project/alpha"],
      tasks: [task("Plan.md", 3, "Call Ana", "2026-11-20")],
    }),
    doc("Notes/Day.md", {
      tags: ["daily"],
      tasks: [task("Notes/Day.md", 0, "Buy milk", null)],
      links: [
        { target: "Plan", resolved: "/v/Plan.md", line: 4, text: "the plan" },
      ],
    }),
  ];
  const index = {
    documents,
    byPath: new Map(documents.map((d) => [d.path, d])),
  };
  return { ...real, refreshMetadataIndex: vi.fn(async () => index) };
});

describe("the app's own folder tools", () => {
  it("answer from the folder's index with paths in it and lines from 1", async () => {
    const { appTool } = await import("./app-ai-tools");
    expect(await appTool("list_tasks", { due_before: "2026-12-01" })).toBe(
      "Plan.md:4: [ ] Call Ana (due 2026-11-20)",
    );
    expect(await appTool("backlinks", { path: "Plan.md" })).toBe(
      "Notes/Day.md:5: the plan",
    );
    expect(await appTool("notes_with_tag", { tag: "#project" })).toBe(
      "Plan.md - Plan",
    );
    await expect(appTool("nothing", {})).rejects.toThrow("No tool nothing.");
  });

  it("read the AI's folder its call names, not the sidebar's", async () => {
    const { appTool } = await import("./app-ai-tools");
    const { refreshMetadataIndex } =
      await import("../workspace/metadata-cache");
    await appTool("list_tags", { __root: "/ai" });
    expect(vi.mocked(refreshMetadataIndex)).toHaveBeenLastCalledWith(
      "textus",
      "/ai",
    );
    await appTool("list_tags", {});
    expect(vi.mocked(refreshMetadataIndex)).toHaveBeenLastCalledWith(
      "textus",
      "/v",
    );
  });
});
