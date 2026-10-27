import { describe, expect, it } from "vitest";
import { paletteEntries } from "./command-palette";
import type { MenuNode } from "./menu/app-menu-model";

const MENU: MenuNode[] = [
  {
    label: "File",
    submenu: [
      { label: "Save", accel: "mod+s", action: { native: "save-file" } },
      {
        label: "Open Recent",
        submenu: [{ label: "a.md", action: { native: "recent:/a.md" } }],
      },
      "separator",
      {
        label: "Close Folder",
        disabled: true,
        action: { native: "close-folder" },
      },
    ],
  },
  {
    label: "View",
    submenu: [
      { label: "Command Palette…", action: { native: "command-palette" } },
      { label: "Full Screen", action: { local: "fullscreen" } },
    ],
  },
  {
    label: "Plugins",
    submenu: [
      { label: "Count", action: { native: "plugin-command:jane.count" } },
    ],
  },
];

describe("paletteEntries", () => {
  it("lists what the menus do, with the way there and the keys", () => {
    const entries = paletteEntries(MENU, []);
    expect(entries.map((e) => [e.label, e.where, e.keys])).toEqual([
      ["Save", "File", "mod+s"],
      ["Full Screen", "View", undefined],
      ["Count", "Plugins", undefined],
    ]);
  });

  it("adds the commands no menu item runs", () => {
    const entries = paletteEntries(MENU, [
      { id: "jane.count", title: "Count words" },
      { id: "jane.stamp", title: "Stamp", shortcut: "mod+alt+t" },
    ]);
    expect(entries.at(-1)).toEqual({
      label: "Stamp",
      keys: "mod+alt+t",
      run: { command: "jane.stamp" },
    });
    expect(entries.filter((e) => e.label.startsWith("Count"))).toHaveLength(1);
  });
});
