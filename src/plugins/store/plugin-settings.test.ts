import { describe, expect, it, vi } from "vitest";
import { settingShown } from "./plugin-settings";

describe("settingShown", () => {
  const values: Record<string, unknown> = {
    legend: true,
    grid: false,
    style: "dark",
    words: [],
  };
  const value = (key: string) => values[key];

  it("shows a setting with no condition", () => {
    expect(settingShown(undefined, value)).toBe(true);
  });

  it("reads a key as on or off, a list as on when it has anything", () => {
    expect(settingShown("legend", value)).toBe(true);
    expect(settingShown("grid", value)).toBe(false);
    expect(settingShown("!grid", value)).toBe(true);
    expect(settingShown("words", value)).toBe(false);
  });

  it("compares a key with a value", () => {
    expect(settingShown("style == dark", value)).toBe(true);
    expect(settingShown("style != dark", value)).toBe(false);
    expect(settingShown("style == light", value)).toBe(false);
  });
});

describe("a folder's plugin settings", () => {
  it("are used only once the user says so, asked once per folder", async () => {
    vi.resetModules();
    const ask = vi.fn(async () => false);
    const kept: Record<string, unknown> = {};
    vi.doMock("../../engine/controls/app-dialog", () => ({ showConfirm: ask }));
    vi.doMock("../../storage/ui-state", () => ({
      getUiState: (key: string) => kept[key],
      setUiState: (key: string, value: unknown) => (kept[key] = value),
    }));
    vi.doMock("../../storage/project-settings", () => ({
      readProjectSettings: async () => ({
        plugins: { "a.sync": { server: "https://elsewhere" } },
      }),
      updateProjectSettings: async () => {},
    }));
    vi.doMock("../../prefs/settings-store", () => ({
      loadSettings: () => ({
        plugins: { "a.sync": { server: "https://mine" } },
      }),
      persist: () => {},
      subscribeRemote: () => () => {},
    }));
    const settings = await import("./plugin-settings");
    await settings.loadProjectPluginSettings("/cloned");
    expect(ask).toHaveBeenCalledTimes(1);
    // Refused: the user's own value stands.
    expect(settings.pluginValue("a.sync", "server")).toEqual({
      value: "https://mine",
      from: "global",
    });
    await settings.loadProjectPluginSettings(null);
    await settings.loadProjectPluginSettings("/cloned");
    expect(ask).toHaveBeenCalledTimes(1);
    expect(kept.pluginFolders).toEqual({ "/cloned": "skip" });
  });
});
