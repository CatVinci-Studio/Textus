// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en";
import type { Strings } from "../../i18n/strings";
import { registerCommand } from "../../app/commands";
import { defaultShortcuts } from "../../prefs/SettingsContext";

const notices = vi.hoisted(() => ({ showNotice: vi.fn() }));
vi.mock("../../ui/notices", () => notices);

import { configurePlugins } from "../store/plugin-records";
import { pluginKey } from "./plugin-keys";

const zotero = { id: "a.zotero", name: "Zotero" };
const cite = { id: "a.zotero.cite", title: "Cite" };
let overrides: Record<string, string> = {};

beforeEach(() => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  localStorage.clear();
  overrides = {};
  configurePlugins({
    strings: () => en as Strings,
    language: () => "en",
    dark: () => false,
    keys: () => ({ shortcuts: defaultShortcuts(), overrides }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  notices.showNotice.mockClear();
});

it("leaves a key the editor has unbound, and says so once", () => {
  expect(pluginKey(zotero, cite, "mod+alt+c")).toBeUndefined();
  expect(pluginKey(zotero, cite, "mod+alt+c")).toBeUndefined();
  expect(notices.showNotice).toHaveBeenCalledTimes(1);
  expect(notices.showNotice.mock.calls[0][0]).toContain("Code Block");
});

it("leaves macOS's own keys and app actions' keys unbound", () => {
  expect(pluginKey(zotero, cite, "mod+alt+d")).toBeUndefined();
  expect(pluginKey(zotero, cite, "mod+shift+p")).toBeUndefined();
});

it("keeps a key no one has, one an earlier plugin took stays its", () => {
  expect(pluginKey(zotero, cite, "mod+alt+z")).toBe("mod+alt+z");
  const undo = registerCommand({
    id: "a.other.go",
    title: () => "Go",
    run: () => {},
    shortcut: "mod+alt+j",
  });
  expect(pluginKey(zotero, cite, "mod+alt+j")).toBeUndefined();
  undo();
});

it("keeps the key the user set in Settings", () => {
  overrides = { [cite.id]: "mod+alt+c" };
  expect(pluginKey(zotero, cite, "mod+alt+c")).toBe("mod+alt+c");
});
