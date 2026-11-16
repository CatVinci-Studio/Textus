import { expect, it, vi } from "vitest";

const runBackground = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../host/background-host", () => ({ runBackground }));
vi.mock("../../platform/ipc-schedule", () => ({
  schedule: {
    takeRuns: async () => [
      { plugin: "local.later", job: "j", run: "r", due: 0, root: null },
    ],
  },
}));
vi.mock("../../platform/ipc", () => ({
  plugins: {
    state: async () => ({
      allOn: true,
      plugins: { "local.later": { enabled: true, granted: ["background"] } },
    }),
    installed: async () => [
      {
        id: "local.later",
        dev: false,
        manifest: JSON.stringify({
          id: "local.later",
          name: "Later",
          version: "0.1.0",
          publisher: "local",
          description: "Runs later.",
          engines: { textus: ">=99.0.0" },
          main: "host.js",
          permissions: ["background"],
          contributes: {},
        }),
      },
    ],
  },
}));

import { runWaitingJobs } from "./run-jobs";

it("runs no job of a plugin this Textus no longer fits", async () => {
  await runWaitingJobs({
    language: "en",
    platform: "macos",
    theme: "light",
    appState: () => ({}) as never,
  });
  expect(runBackground).not.toHaveBeenCalled();
});
