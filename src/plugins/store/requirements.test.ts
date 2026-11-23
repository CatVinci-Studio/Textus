import { beforeEach, describe, expect, it, vi } from "vitest";

let windows = true;
vi.mock("../../platform/capabilities", async (actual) => ({
  ...(await actual<typeof import("../../platform/capabilities")>()),
  get canUseWindows() {
    return windows;
  },
}));
const showConfirm = vi.fn(() => Promise.resolve(false));
vi.mock("../../engine/controls/app-dialog", () => ({ showConfirm }));
vi.mock("../../prefs/settings-store", () => ({
  loadSettings: () => ({ runInBackground: false }),
  changeSettings: vi.fn(),
}));
const manifest = {
  requires: [{ setting: "runInBackground" as const, reason: "tray" }],
};
vi.mock("./plugin-records", () => ({
  pluginName: () => "Quick Notes",
  pluginText: (_r: unknown, text: string) => text,
  pluginsSnapshot: () => ({
    records: [{ id: "a.b", status: "on", manifest }],
  }),
}));

const { askForRequirements, requirementsHere } = await import("./requirements");
const t = {
  pluginRequiresAsk: "{name} {setting} {reason}",
  backgroundToggle: "Keep running in the background",
  pluginTurnOn: "Turn On",
  pluginRequiresLater: "Later",
} as unknown as Parameters<typeof askForRequirements>[1];

describe("what a plugin requires, where", () => {
  beforeEach(() => showConfirm.mockClear());

  it("asks to keep Textus running where there are windows to close", async () => {
    windows = true;
    expect(requirementsHere(manifest)).toEqual(manifest.requires);
    await askForRequirements("a.b", t);
    expect(showConfirm).toHaveBeenCalledTimes(1);
  });

  it("neither shows nor asks for it on a phone, which has no tray", async () => {
    windows = false;
    expect(requirementsHere(manifest)).toEqual([]);
    await askForRequirements("a.b", t);
    expect(showConfirm).not.toHaveBeenCalled();
  });
});
