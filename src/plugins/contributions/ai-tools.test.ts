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
