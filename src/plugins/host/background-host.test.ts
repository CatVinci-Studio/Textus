// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseManifest, type Permission } from "../store/manifest";
import type { BackgroundRun } from "./background-host";

const ipc = vi.hoisted(() => ({
  set: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("../../platform/ipc-schedule", async (actual) => ({
  ...(await actual<typeof import("../../platform/ipc-schedule")>()),
  schedule: {
    set: ipc.set,
    notify: ipc.notify,
    clear: vi.fn(),
    list: vi.fn(() => Promise.resolve([])),
  },
}));

const { backgroundHandlers } = await import("./background-host");

function run(
  granted: Permission[],
  manifest: Record<string, unknown> = {},
): BackgroundRun {
  return {
    info: {
      manifest: parseManifest({
        id: "catvinci.remind",
        name: "Remind",
        version: "0.1.0",
        publisher: "catvinci",
        engines: { textus: ">=1.3.0-beta.8" },
        permissions: granted,
        ...manifest,
      }),
      origin: "installed",
      granted,
    },
    job: "morning",
    run: "remind",
    due: 0,
    root: "/notes",
    env: {
      language: "en",
      appVersion: "1.3.0",
      platform: "macos",
      theme: "light",
      appState: "background",
    },
    setting: () => Promise.resolve(null),
  };
}

type Call = (params: unknown) => Promise<unknown> | unknown;
const handler = (r: BackgroundRun, name: string) =>
  (backgroundHandlers(r) as unknown as Record<string, Call>)[name];

beforeEach(() => {
  ipc.set.mockReset().mockResolvedValue({ id: "morning" });
  ipc.notify.mockReset().mockResolvedValue(undefined);
});

describe("a plugin's background code", () => {
  it("reaches its files, the network, storage, schedule and notify - no editor, UI or layout", () => {
    const names = Object.keys(backgroundHandlers(run([])));
    for (const reached of [
      "files.read",
      "net.fetch",
      "store.get",
      "secrets.get",
      "settings.get",
      "schedule.set",
      "notify.show",
      "app.state",
    ])
      expect(names).toContain(reached);
    for (const kept of names)
      expect(kept).not.toMatch(
        /^(editor|ui|layout|views|webview|commands|metadata|clipboard|plugins)\./,
      );
    expect(names).not.toContain("files.willSave");
    expect(names).not.toContain("export.willExport");
  });

  it("is told it runs with no window", () => {
    expect(handler(run([]), "app.state")({})).toBe("background");
  });

  it("works in the folder open when its job was set, with files.read", () => {
    expect(() =>
      handler(run([]), "files.read")({ path: "/notes/a.md" }),
    ).toThrow(/files.read/);
  });
});

describe("scheduling and notifying", () => {
  it("needs notifications to notify, background to run", async () => {
    const notify = { notify: { title: "Write" }, daily: "09:00" };
    await expect(
      handler(run([]), "schedule.set")({ id: "a", job: notify }),
    ).rejects.toThrow(/notifications/);
    await expect(
      handler(
        run(["notifications"]),
        "schedule.set",
      )({
        id: "a",
        job: { run: "remind", daily: "09:00" },
      }),
    ).rejects.toThrow(/background/);
    await expect(
      handler(run(["notifications"]), "notify.show")({ title: "Now" }),
    ).resolves.toBeUndefined();
    expect(() => handler(run([]), "notify.show")({ title: "Now" })).toThrow(
      /notifications/,
    );
  });

  it("runs only what the manifest's background code holds", async () => {
    await expect(
      handler(
        run(["background"]),
        "schedule.set",
      )({
        id: "a",
        job: { run: "remind", every: "1h" },
      }),
    ).rejects.toThrow(/background/);
    const r = run(["background"], { background: "background.js" });
    await handler(
      r,
      "schedule.set",
    )({
      id: "a",
      job: { run: "remind", every: "1h" },
    });
    expect(ipc.set).toHaveBeenCalledWith(
      "catvinci.remind",
      "a",
      { run: "remind", every: "1h" },
      null,
    );
  });

  it("gives Rust the job's folder only with files.read", async () => {
    const job = { notify: { title: "t" }, daily: "09:00" };
    await handler(
      run(["notifications", "files.read"]),
      "schedule.set",
    )({
      id: "a",
      job,
    });
    expect(ipc.set).toHaveBeenLastCalledWith(
      "catvinci.remind",
      "a",
      job,
      "/notes",
    );
  });
});

describe("the runtime in background code", () => {
  it("throws, saying why, where the editor or UI is reached", () => {
    const host = readFileSync(join(__dirname, "runtime", "host.js"), "utf8");
    const w = window as unknown as Record<string, unknown>;
    w.__textusBackground = true;
    w.createEndpoint = () => ({ call: () => Promise.resolve(), notify() {} });
    new Function("createEndpoint", host)(w.createEndpoint);
    const textus = w.textus as Record<string, Record<string, unknown>>;
    expect(() => textus.editor.getText).toThrow(
      "textus.editor is not available in background code.",
    );
    expect(() => textus.ui.notice).toThrow(/textus.ui/);
    expect(typeof textus.schedule.set).toBe("function");
    expect(typeof textus.notify.show).toBe("function");
    delete w.__textusBackground;
  });
});
