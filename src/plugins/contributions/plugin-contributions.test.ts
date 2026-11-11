import { afterEach, expect, it, vi } from "vitest";

const { run, showMessage } = vi.hoisted(() => ({
  run: new Map<string, () => void>(),
  showMessage: vi.fn(async () => {}),
}));
vi.mock("../../registry/commands", () => ({
  registerCommand: (c: { id: string; run: () => void }) => {
    run.set(c.id, c.run);
    return () => run.delete(c.id);
  },
  runCommand: vi.fn(),
}));
vi.mock("../../engine/controls/app-dialog", () => ({ showMessage }));
vi.mock("../../i18n/current", async () => {
  const zh = (await import("../../i18n/locales/zh")).default;
  return { currentStrings: () => zh };
});

const { applyContributions, withdrawContributions } =
  await import("./plugin-contributions");
const { parseManifest } = await import("../store/manifest");

afterEach(() => withdrawContributions("local.todo"));

it("says a plugin command's failure in the user's language, under the plugin's name", async () => {
  const manifest = parseManifest(
    JSON.stringify({
      id: "local.todo",
      name: "Todo",
      version: "0.1.0",
      publisher: "local",
      engines: { textus: ">=1.3.0" },
      main: "host.js",
      contributes: {
        commands: [{ command: "local.todo.add", title: "Add" }],
      },
    }),
  );
  applyContributions(
    {
      id: "local.todo",
      origin: "local",
      manifest,
      status: "on",
      granted: [],
      official: false,
    } as never,
    {
      runPluginCommand: () => Promise.reject(new Error("No folder is open.")),
      start: async () => {},
    },
  );
  run.get("local.todo.add")!();
  await vi.waitFor(() => expect(showMessage).toHaveBeenCalled());
  expect(showMessage).toHaveBeenCalledWith("请先打开一个文件夹。", {
    title: "Todo",
    tone: "error",
  });
});
