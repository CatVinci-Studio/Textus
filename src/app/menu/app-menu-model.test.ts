// @vitest-environment jsdom
//
// formatCombo reads navigator, which Node 20 doesn't define globally.

import { describe, expect, it } from "vitest";
import {
  defaultShortcuts,
  type Shortcuts,
} from "../../settings/SettingsContext";
import type { Strings } from "../../i18n/strings";
import { APP_NAME, resolveStrings } from "../../i18n/strings";
import { formatCombo } from "../../utils/shortcuts";
import { LANGS } from "../../i18n/langs";
import {
  buildAppMenu,
  buildMobileMenu,
  menuBarSections,
  NO_RECENTS,
  nativeMenuChecks,
  type MenuNode,
} from "./app-menu-model";
import { nativeMenuAccelerators, nativeMenuLabels } from "./native-menu-text";
import { readFileSync } from "node:fs";

/**
 * The app-drawn menu is the only menu Windows users see. Its combos diverge
 * from the macOS ones on purpose; asserted as stored strings so the suite
 * doesn't depend on the platform.
 */

const t = resolveStrings("en") as Strings;

const shortcuts: Shortcuts = {
  ...defaultShortcuts(false),
  triggerCompletion: "mod+shift+space",
  triggerGrammarCheck: "mod+shift+g",
  toggleFloatingChat: "mod+shift+k",
  toggleSidebar: "mod+\\",
  toggleAgentPanel: "mod+shift+l",
  toggleSplitView: "mod+shift+e",
  toggleZenMode: "mod+shift+j",
  toggleSourceMode: "mod+/",
  toggleTypewriterMode: "",
  findReplace: "mod+f",
  searchFiles: "mod+shift+o",
};

/** Every entry in the tree, submenus included. */
function flatten(nodes: MenuNode[]): Exclude<MenuNode, "separator">[] {
  return nodes.flatMap((node) =>
    node === "separator"
      ? []
      : [node, ...(node.submenu ? flatten(node.submenu) : [])],
  );
}

const entries = flatten(buildAppMenu(t, shortcuts, NO_RECENTS));

function accelOf(label: string): string | undefined {
  const found = entries.find((entry) => entry.label === label);
  expect(found, `no menu entry labelled "${label}"`).toBeDefined();
  return found?.accel;
}

describe("the Windows app menu", () => {
  it("offers Alt+F4 for Exit, not Ctrl+Q", () => {
    // Ctrl+Q closes nothing on Windows: a hint for a dead combo.
    expect(accelOf(t.menuExit)).toBe("alt+f4");
    expect(entries.map((entry) => entry.accel)).not.toContain("mod+q");
  });

  it("keeps a browser's tab keys: Ctrl+T, Ctrl+N, Ctrl+W, Ctrl+Shift+T", () => {
    expect(accelOf(t.menuNewTab)).toBe("mod+t");
    expect(accelOf(t.menuNewWindow)).toBe("mod+n");
    expect(accelOf(t.menuCloseTab)).toBe("mod+w");
    expect(accelOf(t.menuReopenClosedTab)).toBe("mod+shift+t");
  });

  it("shows Ctrl+Y for Redo", () => {
    // The history keymap binds both; Windows advertises Mod-y.
    expect(accelOf(t.menuRedo)).toBe("mod+y");
  });

  it("advertises F11 for fullscreen", () => {
    // Bound in a keydown handler: there is no native item to hang it on.
    expect(accelOf(t.menuFullscreen)).toBe("f11");
  });

  it("renders function-key combos through formatCombo intact", () => {
    // "f11"/"f4" have no key label and fall through to toUpperCase.
    expect(formatCombo("f11")).toBe("F11");
    expect(formatCombo("alt+f4")).toContain("F4");
  });
});

describe("the View menu's on/off items", () => {
  // Each on/off item is named by the thing it shows, in every language, not
  // "Toggle ...".
  const TOGGLE_WORDS =
    /toggle|切换|切換|切り替え|전환|보기\/숨기기|ein\/aus|ein-\/ausblenden|alternar|basculer|переключ/i;

  it.each(LANGS)(
    "never say Toggle, and all carry a check state (%s)",
    (lang) => {
      const strings = resolveStrings(lang) as Strings;
      const view = buildAppMenu(strings, shortcuts, NO_RECENTS).find(
        (node) => node !== "separator" && node.label === strings.menuView,
      );
      expect(view).toBeDefined();
      const items = flatten(
        view === undefined || view === "separator" ? [] : (view.submenu ?? []),
      );
      const onOff = items.filter((item) => item.checked !== undefined);
      expect(onOff).toHaveLength(7);
      for (const item of items) expect(item.label).not.toMatch(TOGGLE_WORDS);
      const phone = flatten(buildMobileMenu(strings));
      for (const item of phone) expect(item.label).not.toMatch(TOGGLE_WORDS);
      expect(
        phone.find((item) => item.label === strings.menuViewSidebar)?.checked,
      ).toBe(false);
    },
  );

  it("show what is on", () => {
    const view = buildAppMenu(t, shortcuts, NO_RECENTS, {
      sidebar: true,
      textusAi: false,
      zen: true,
      fullscreen: true,
    });
    const checked = flatten(view)
      .filter((item) => item.checked)
      .map((item) => item.label);
    expect(checked).toEqual([
      t.menuToggleSidebar,
      t.menuToggleZenMode,
      t.menuFullscreen,
    ]);
  });

  it("keep Textus AI out of View, the AI panel out of reach while it is off, and the switch in the phone's menu", () => {
    const items = (checks: { textusAi?: boolean }) =>
      flatten(buildAppMenu(t, shortcuts, NO_RECENTS, checks));
    const panel = (checks: { textusAi?: boolean }) =>
      items(checks).find((item) => item.label === t.menuToggleAgentPanel);
    // The window bar's button and Settings carry the switch on a desktop.
    expect(items({}).find((item) => item.label === t.menuTextusAi)).toBe(
      undefined,
    );
    expect(nativeMenuChecks({})).not.toHaveProperty("toggle-textus-ai");
    expect(panel({})?.disabled).toBe(false);
    expect(panel({ textusAi: false })?.disabled).toBe(true);
    const phone = flatten(buildMobileMenu(t, { textusAi: false }));
    expect(phone.find((item) => item.label === t.menuTextusAi)?.checked).toBe(
      false,
    );
  });

  it("send the macOS bar every native on/off item by id", () => {
    const ids = flatten(buildAppMenu(t, shortcuts, NO_RECENTS))
      .filter((item) => item.checked !== undefined)
      .flatMap((item) =>
        item.action && "native" in item.action ? [item.action.native] : [],
      );
    expect(Object.keys(nativeMenuChecks({})).sort()).toEqual(ids.sort());
    expect(nativeMenuChecks({ splitView: true })["toggle-split-view"]).toBe(
      true,
    );
  });
});

describe("File > Open Recent", () => {
  const recentMenu = (recents: Parameters<typeof buildAppMenu>[2]) =>
    flatten(buildAppMenu(t, shortcuts, recents)).find(
      (item) => item.label === t.menuOpenRecent,
    )!.submenu!;

  it("lists folders above files, each folder's name ending in a separator", () => {
    const menu = recentMenu({
      files: ["/notes/a.md"],
      folders: ["/notes/novel", "D:\\Writing\\"],
    });
    expect(
      menu.map((node) =>
        node === "separator" ? "-" : [node.label, node.action],
      ),
    ).toEqual([
      ["novel/", { native: "recent-folder:/notes/novel" }],
      ["Writing\\", { native: "recent-folder:D:\\Writing\\" }],
      "-",
      ["a.md", { native: "recent:/notes/a.md" }],
      "-",
      [t.menuRecentClear, { native: "recent-clear" }],
    ]);
  });

  it("says it is empty with neither", () => {
    expect(recentMenu(NO_RECENTS)).toEqual([
      { label: t.menuRecentNone, disabled: true },
    ]);
  });

  it("offers Close Folder only while a folder is open", () => {
    const close = (folderOpen: boolean) =>
      flatten(buildAppMenu(t, shortcuts, NO_RECENTS, { folderOpen })).find(
        (item) => item.label === t.menuCloseFolder,
      )!;
    expect(close(false).disabled).toBe(true);
    expect(close(true).disabled).toBe(false);
  });
});

describe("the macOS menu bar's labels", () => {
  it("label every native item the app-drawn menu has, in the UI's language", () => {
    const zh = resolveStrings("zh");
    const labels = nativeMenuLabels(zh);
    const ids: string[] = [];
    const collect = (nodes: MenuNode[]) => {
      for (const node of nodes) {
        if (node === "separator") continue;
        if (node.action && "native" in node.action)
          ids.push(node.action.native);
        if (node.submenu) collect(node.submenu);
      }
    };
    collect(buildAppMenu(zh, shortcuts, NO_RECENTS));
    for (const id of ids) expect(labels[id], id).toBeTruthy();
    expect(labels["insert-block:h2"]).toBe(
      zh.menuHeadingTemplate.replace("{n}", "2"),
    );
    expect(labels["menu:edit"]).toBe(zh.menuEdit);
    expect(labels["predefined:copy"]).toBe(zh.copy);
  });

  it("name the app where macOS does", () => {
    const labels = nativeMenuLabels(t);
    expect(labels.quit).toBe(`Quit ${APP_NAME}`);
    expect(labels["predefined:about"]).toBe(`About ${APP_NAME}`);
    expect(labels["predefined:hide"]).toBe(`Hide ${APP_NAME}`);
  });
});

describe("the Format menu's heading keys", () => {
  it("show Ctrl+1..6 in the app-drawn menu by default", () => {
    for (const level of [1, 2, 3, 4, 5, 6])
      expect(accelOf(`Heading ${level}`)).toBe(`mod+${level}`);
  });

  it("go to the macOS bar as muda reads them, only for bound levels", () => {
    expect(
      nativeMenuAccelerators({
        ...shortcuts,
        setHeading2: "mod+shift+2",
        setHeading3: "",
        setHeading4: "ctrl+alt+4",
      }),
    ).toEqual({
      "insert-block:h1": "CmdOrCtrl+1",
      "insert-block:h2": "CmdOrCtrl+Shift+2",
      "insert-block:h4": "Ctrl+Alt+4",
      "insert-block:h5": "CmdOrCtrl+5",
      "insert-block:h6": "CmdOrCtrl+6",
    });
  });

  it("match the ids menu.rs builds the heading items with", () => {
    const source = ["menu.rs", "menu/build.rs"]
      .map((file) => readFileSync(`src-tauri/src/${file}`, "utf8"))
      .join("\n");
    expect(source).toContain('("h2", "Heading 2")');
    expect(source).toContain('INSERT_BLOCK_PREFIX: &str = "insert-block:"');
  });
});

describe("menu bar", () => {
  it("has a title per submenu, with Settings… and Exit at the end of File", () => {
    const sections = menuBarSections(buildAppMenu(t, shortcuts, NO_RECENTS));
    expect(sections.map((s) => s.label)).not.toContain(t.menuSettings);
    expect(sections.map((s) => s.label)).not.toContain(t.menuExit);
    expect(sections[0]?.label).toBe(t.menuFile);
    const file = sections[0]!.items.map((n) =>
      n === "separator" ? n : n.label,
    );
    expect(file.slice(-3)).toEqual(["separator", t.menuSettings, t.menuExit]);
    for (const section of sections)
      expect(section.items.length).toBeGreaterThan(0);
  });
});
