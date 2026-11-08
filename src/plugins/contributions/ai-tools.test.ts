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
  it("tells the model the translated description, not its key", () => {
    expect(offered()).toEqual([
      expect.objectContaining({
        plugin: "catvinci.tasks",
        name: "list_tasks",
        description: "List the tasks in the open folder.",
      }),
    ]);
  });
});

describe("a plugin's tools", () => {
  it("are offered to Textus AI only with the ai.tools grant", async () => {
    const { offered } = await import("./ai-tools");
    expect(offered().map((t) => t.name)).toEqual(["list_tasks"]);
  });
});
