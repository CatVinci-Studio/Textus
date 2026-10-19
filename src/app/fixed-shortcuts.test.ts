// @vitest-environment jsdom
//
// isReservedCombo and defaultShortcuts read navigator.platform.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStrings, type Strings } from "../i18n/strings";
import {
  defaultShortcuts,
  type ShortcutAction,
} from "../settings/SettingsContext";
import { isBindableCombo, isReservedCombo } from "../utils/shortcuts";
import { buildAppMenu, type MenuNode } from "./app-menu-model";
import {
  fixedShortcutGroups,
  macTabStep,
  MAC_NEXT_TAB,
  MAC_PREVIOUS_TAB,
  type ShortcutPlatform,
} from "./fixed-shortcuts";

const t = resolveStrings("en") as Strings;
const PLATFORMS: ShortcutPlatform[] = ["macos", "windows", "linux"];
const NAVIGATOR_PLATFORM: Record<ShortcutPlatform, string> = {
  macos: "MacIntel",
  ios: "iPad",
  windows: "Win32",
  linux: "Linux x86_64",
};

afterEach(() => vi.restoreAllMocks());

function onPlatform(platform: ShortcutPlatform) {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(
    NAVIGATOR_PLATFORM[platform],
  );
}

function fixedCombos(platform: ShortcutPlatform): string[] {
  return fixedShortcutGroups(t, platform).flatMap((group) =>
    group.items.flatMap((item) => item.combos),
  );
}

function menuCombos(nodes: MenuNode[]): string[] {
  return nodes.flatMap((node) =>
    node === "separator"
      ? []
      : [
          ...(node.accel ? [node.accel] : []),
          ...(node.submenu ? menuCombos(node.submenu) : []),
        ],
  );
}

/** menu.rs's accelerators ("CmdOrCtrl+Shift+S"), as stored combos. */
function nativeAccelerators(): string[] {
  const source = readFileSync("src-tauri/src/menu.rs", "utf8");
  const written = [
    ...source.matchAll(/\.accelerator\("([^"]+)"\)/g),
    ...source.matchAll(/const \w+_ACCEL: &str = "([^"]+)"/g),
  ].map((match) => match[1]);
  return written.map((accel) =>
    accel.toLowerCase().replace("cmdorctrl", "mod"),
  );
}

describe("the fixed shortcuts in Settings", () => {
  it("list every combo the app menu shows that can't be rebound", () => {
    const unbound = Object.fromEntries(
      Object.keys(defaultShortcuts()).map((key) => [key, ""]),
    ) as Record<ShortcutAction, string>;
    const fromMenu = menuCombos(buildAppMenu(t, unbound, []));
    expect(fromMenu.length).toBeGreaterThan(10);
    expect(fixedCombos("windows")).toEqual(expect.arrayContaining(fromMenu));
  });

  it("match the macOS menu bar's accelerators in menu.rs", () => {
    const native = nativeAccelerators();
    expect(native).toContain("mod+shift+n");
    const mac = fixedCombos("macos");
    // Both ways: nothing menu.rs binds is missing from the list, and the
    // list claims no menu combo menu.rs doesn't bind. The rest are muda's
    // predefined Edit items, the editor's own keys and the tab keys.
    expect(mac).toEqual(expect.arrayContaining(native));
    const outsideMenuRs = new Set([
      "mod+z",
      "mod+shift+z",
      "mod+x",
      "mod+c",
      "mod+v",
      "mod+a",
      "mod+b",
      "mod+i",
      "mod+enter",
      MAC_NEXT_TAB,
      MAC_PREVIOUS_TAB,
    ]);
    expect(mac.filter((combo) => !outsideMenuRs.has(combo)).sort()).toEqual(
      [...new Set(native)].sort(),
    );
  });

  it("show Quit as Cmd+Q on a Mac and Exit as Alt+F4 on Windows", () => {
    expect(fixedCombos("macos")).toContain("mod+q");
    expect(fixedCombos("macos")).not.toContain("alt+f4");
    expect(fixedCombos("windows")).toContain("alt+f4");
    expect(fixedCombos("windows")).not.toContain("mod+q");
    expect(fixedCombos("linux")).toContain("mod+q");
  });

  it("show F11 only where the app handles it", () => {
    expect(fixedCombos("windows")).toContain("f11");
    expect(fixedCombos("linux")).toContain("f11");
    expect(fixedCombos("macos")).not.toContain("f11");
  });

  it("include the editor's formatting and leave-block keys", () => {
    for (const platform of PLATFORMS)
      expect(fixedCombos(platform)).toEqual(
        expect.arrayContaining(["mod+b", "mod+i", "mod+enter", "mod+z"]),
      );
  });

  it.each(PLATFORMS)("can't be bound to an action (%s)", (platform) => {
    onPlatform(platform);
    for (const combo of fixedCombos(platform))
      expect(isReservedCombo(combo), combo).toBe(true);
  });
});

describe("the default configurable shortcuts", () => {
  it.each(PLATFORMS)(
    "are each different, and none is a fixed one (%s)",
    (platform) => {
      onPlatform(platform);
      const bound = Object.values(defaultShortcuts()).filter(Boolean);
      expect(new Set(bound).size).toBe(bound.length);
      for (const combo of bound) {
        expect(isBindableCombo(combo), combo).toBe(true);
        expect(isReservedCombo(combo), combo).toBe(false);
        expect(fixedCombos(platform)).not.toContain(combo);
      }
    },
  );

  it("switch tabs with Ctrl+Tab and Ctrl+Shift+Tab on every platform", () => {
    // Ctrl is "ctrl" on a Mac, where "mod" is Cmd.
    expect(defaultShortcuts(true)).toMatchObject({
      nextTab: "ctrl+tab",
      previousTab: "ctrl+shift+tab",
    });
    expect(defaultShortcuts(false)).toMatchObject({
      nextTab: "mod+tab",
      previousTab: "mod+shift+tab",
    });
  });

  it("leave the heading levels unbound and Mod+Shift+O free", () => {
    for (const mac of [true, false]) {
      const shortcuts = defaultShortcuts(mac);
      for (const action of [
        "setHeading1",
        "setHeading2",
        "setHeading3",
        "setHeading4",
        "setHeading5",
        "setHeading6",
        "setParagraph",
      ] as const)
        expect(shortcuts[action]).toBe("");
      // Taken by another 1.2.0 feature.
      expect(Object.values(shortcuts)).not.toContain("mod+shift+o");
    }
  });
});

describe("macOS's Cmd+Shift+] and [", () => {
  const key = (code: string, mods: Partial<KeyboardEvent> = {}) =>
    new KeyboardEvent("keydown", {
      code,
      key: code === "BracketRight" ? "}" : "{",
      metaKey: true,
      shiftKey: true,
      ...mods,
    });

  it("step to the next and the previous tab by physical key", () => {
    expect(macTabStep(key("BracketRight"), true)).toBe(1);
    expect(macTabStep(key("BracketLeft"), true)).toBe(-1);
  });

  it("do nothing without Shift, with another modifier, or off a Mac", () => {
    expect(macTabStep(key("BracketRight", { shiftKey: false }), true)).toBe(
      null,
    );
    expect(macTabStep(key("BracketRight", { altKey: true }), true)).toBe(null);
    expect(macTabStep(key("BracketRight"), false)).toBe(null);
  });
});
