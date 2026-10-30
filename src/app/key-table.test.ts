// @vitest-environment jsdom
//
// Every fixed keyboard shortcut in one table, with who answers it on each
// platform, checked against the places that claim keys: the native menu
// (src-tauri/src/menu.rs, menu/build.rs), the window's handler
// (useGlobalShortcuts.ts, and the configurable defaults) and the editor's
// keymaps (a real editor, asked key by key).
//
// Who gets a key first differs by platform. macOS: the native menu, before
// the page sees it. Windows: the page; a key it doesn't take goes on to the
// hidden menu's accelerators. Linux: the page only, as GTK's hidden menu bar
// fires none.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeViews, openView } from "../document-view/editor-view-kit";
import { defaultShortcuts } from "../prefs/shortcut-defaults";
import {
  eventOf,
  nativeAccelerators,
  predefinedOnMac,
  type Platform,
} from "./native-menu-keys";
import {
  LINUX_MENU_ACCELERATORS,
  WEBVIEW_FILE_COMMANDS,
} from "./useGlobalShortcuts";

const PLATFORMS: Platform[] = ["macos", "windows", "linux"];

/** Who answers a key: a native menu item (by id), the window's handler,
 *  the editor, or the webview itself (the clipboard's keys). */
type Owner = `menu:${string}` | "window" | "editor" | "webview";

interface Key {
  /** What the key does, for the reader. */
  does: string;
  macos?: Owner;
  windows?: Owner;
  linux?: Owner;
}

const everywhere = (owner: Owner) => ({
  macos: owner,
  windows: owner,
  linux: owner,
});
/** A native item's key, which the window's handler takes where the page
 *  sees keys first: on Windows before the hidden menu, on Linux instead. */
const menuThenWindow = (id: string) => ({
  macos: `menu:${id}` as Owner,
  windows: "window" as Owner,
  linux: "window" as Owner,
});
/** A native item's key that Windows' hidden menu answers; on Linux the
 *  window's handler runs the item. */
const menuOrLinuxWindow = (id: string) => ({
  macos: `menu:${id}` as Owner,
  windows: `menu:${id}` as Owner,
  linux: "window" as Owner,
});
/** The editor's on Windows and Linux; on a Mac the menu item, which hands
 *  it to the editor in focus. */
const menuThenEditor = (id: string) => ({
  macos: `menu:${id}` as Owner,
  windows: "editor" as Owner,
  linux: "editor" as Owner,
});

/** Every fixed combo. The configurable ones are the settings' defaults. */
const KEYS: Record<string, Key> = {
  // File
  "mod+t": { does: "New Tab", ...menuThenWindow("new-file") },
  "mod+n": { does: "New Window", ...menuThenWindow("new-window") },
  "mod+o": { does: "Open…", ...menuThenWindow("open-file") },
  "mod+s": { does: "Save", ...menuThenWindow("save-file") },
  "mod+shift+s": { does: "Save As…", ...menuOrLinuxWindow("save-file-as") },
  "mod+p": { does: "Export › PDF…", ...menuThenWindow("export-pdf") },
  "mod+w": { does: "Close Tab", ...menuThenWindow("close-tab") },
  "mod+shift+t": {
    does: "Reopen Closed Tab",
    ...menuThenWindow("reopen-closed-tab"),
  },
  "mod+shift+w": {
    does: "Close Window",
    ...menuOrLinuxWindow("close-window"),
  },
  "mod+,": { does: "Settings…", ...menuThenWindow("settings") },
  // Windows quits with Alt+F4, the system's.
  "mod+q": { does: "Quit", macos: "menu:quit", linux: "window" },
  // Edit. On a Mac the app's own items, so the editor's history runs.
  "mod+z": { does: "Undo", ...menuThenEditor("undo") },
  "mod+shift+z": { does: "Redo", ...menuThenEditor("redo") },
  "mod+y": { does: "Redo", windows: "editor", linux: "editor" },
  "mod+a": {
    does: "Select All: a code block's code, then the document",
    ...menuThenEditor("select-all"),
  },
  "mod+x": { does: "Cut", ...everywhere("webview") },
  "mod+c": { does: "Copy", ...everywhere("webview") },
  "mod+v": { does: "Paste", ...everywhere("webview") },
  "mod+shift+v": {
    does: "Paste as Plain Text",
    ...menuThenEditor("paste-as-plain-text"),
  },
  // View
  "mod+=": { does: "Zoom In", ...menuOrLinuxWindow("zoom-in") },
  "mod+-": { does: "Zoom Out", ...menuOrLinuxWindow("zoom-out") },
  "mod+0": { does: "Actual Size", ...menuOrLinuxWindow("zoom-reset") },
  // A Mac's full screen key is the system's own.
  f11: { does: "Full Screen", windows: "window", linux: "window" },
  // The window's own keys.
  f6: { does: "Next region", ...everywhere("window") },
  "shift+f6": { does: "Previous region", ...everywhere("window") },
  // The editor's.
  "mod+b": { does: "Bold", ...everywhere("editor") },
  "mod+i": { does: "Italic", ...everywhere("editor") },
  "mod+enter": { does: "Leave the block", ...everywhere("editor") },
  "alt+arrowup": { does: "Move the block up", ...everywhere("editor") },
  "alt+arrowdown": { does: "Move the block down", ...everywhere("editor") },
  tab: { does: "Indent", ...everywhere("editor") },
  "shift+tab": { does: "Outdent", ...everywhere("editor") },
};

/** The window's handler's fixed keys, per platform: its own, the file
 *  commands where the app draws the frame, and Linux's menu keys. */
function windowKeys(platform: Platform): Set<string> {
  return new Set([
    "mod+s",
    "mod+w",
    "f6",
    "shift+f6",
    ...(platform === "macos"
      ? []
      : ["f11", ...Object.keys(WEBVIEW_FILE_COMMANDS)]),
    ...(platform === "linux" ? Object.keys(LINUX_MENU_ACCELERATORS) : []),
  ]);
}

/** The configurable shortcuts, as they ship: the window's handler. */
function configurable(mac: boolean): Record<string, string> {
  return Object.fromEntries(
    Object.entries(defaultShortcuts(mac))
      .filter(([, combo]) => combo)
      .map(([action, combo]) => [combo, action]),
  );
}

/** Every window event the frontend's code names ("menu-…"). */
function frontendEvents(): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
        for (const m of readFileSync(path, "utf8").matchAll(
          /"(menu-[a-z-]+)"/g,
        ))
          names.add(m[1]);
    }
  };
  walk("src");
  return names;
}

// ---- The editor, asked key by key.

const CONTEXTS: [string, string, string][] = [
  ["a paragraph", "Some words here\n", "words"],
  ["a list item", "- one\n- two\n- three\n", "two"],
  ["a code block", "```js\nlet a = 1;\n```\n", "a = 1"],
];

const editorTakes = new Map<string, string[]>();
// Paste as Plain Text reads the clipboard, which jsdom has none of.
Object.defineProperty(navigator, "clipboard", {
  value: { readText: async () => "" },
  configurable: true,
});
afterAll(closeViews);

async function probeEditor() {
  if (editorTakes.size) return editorTakes;
  for (const [context, markdown, at] of CONTEXTS)
    for (const key of Object.keys(KEYS)) {
      const t = await openView(markdown, { enableCompletion: false });
      t.caretAt(at, 1);
      // Something to undo, and to redo: the history's keys do nothing
      // without.
      t.type("x");
      if (key === "mod+shift+z" || key === "mod+y") t.press("Mod+z");
      const press = key
        .split("+")
        .map((part) =>
          part === "mod"
            ? "Mod"
            : part.length === 1
              ? part
              : part[0].toUpperCase() + part.slice(1),
        )
        .join("+")
        .replace("Arrowup", "ArrowUp")
        .replace("Arrowdown", "ArrowDown");
      if (t.press(press))
        editorTakes.set(key, [...(editorTakes.get(key) ?? []), context]);
      await closeViews();
    }
  return editorTakes;
}

describe("the key table", () => {
  it.each(PLATFORMS)(
    "names every native accelerator on %s, answered as the table says",
    (platform) => {
      const native = nativeAccelerators(platform);
      expect(native.get("mod+shift+t")).toBe("reopen-closed-tab");
      for (const [key, id] of native) {
        const owner = KEYS[key]?.[platform];
        expect(owner, `${key} (${id}) is in no row`).toBeDefined();
        // Only a Mac's menu is sure to get its keys.
        if (platform === "macos") expect(owner, key).toBe(`menu:${id}`);
      }
      for (const [key, row] of Object.entries(KEYS)) {
        const owner = row[platform];
        if (owner?.startsWith("menu:"))
          expect(native.get(key), `${key} on ${platform}`).toBe(
            owner.slice("menu:".length),
          );
      }
    },
  );

  it.each(PLATFORMS)(
    "has the window's handler take the keys the table gives it on %s",
    (platform) => {
      const handled = windowKeys(platform);
      for (const [key, row] of Object.entries(KEYS))
        if (row[platform] === "window")
          expect(handled.has(key) || key === "mod+q", key).toBe(true);
    },
  );

  it("runs on Linux the menu item a key stands for, as a Mac's menu would", () => {
    const mac = nativeAccelerators("macos");
    const linux = nativeAccelerators("linux");
    const ids = new Set(mac.values());
    for (const [key, id] of Object.entries(LINUX_MENU_ACCELERATORS))
      // Another spelling of a key is fine (mod++ for mod+=), another item not.
      if (linux.has(key)) expect(linux.get(key), key).toBe(id);
      else expect(ids, key).toContain(id);
    for (const [key, id] of Object.entries(WEBVIEW_FILE_COMMANDS))
      expect(mac.get(key), key).toBe(id);
  });

  it("leaves no Linux menu key unanswered: GTK's hidden menu bar fires none", async () => {
    const takes = await probeEditor();
    const handled = windowKeys("linux");
    for (const key of nativeAccelerators("linux").keys())
      expect(
        handled.has(key) ||
          takes.has(key) ||
          KEYS[key]?.linux === "webview" ||
          key === "mod+q",
        key,
      ).toBe(true);
  });

  it("sends every macOS menu key to something that listens for it", () => {
    const events = frontendEvents();
    for (const [key, id] of nativeAccelerators("macos")) {
      const event = eventOf(id);
      // The backend acts itself: quit, close and open windows.
      if (!event) {
        expect(["quit", "close-window", "new-window"], key).toContain(id);
        continue;
      }
      expect(events.has(event), `${key}: ${event}`).toBe(true);
    }
  });

  it("builds no predefined Undo, Redo or Select All on a Mac, which would bypass the editor's history", () => {
    expect(predefinedOnMac()).toEqual([]);
    expect(nativeAccelerators("macos").get("mod+z")).toBe("undo");
  });

  it("has the configurable shortcuts on keys no fixed one has", () => {
    for (const mac of [true, false])
      for (const [key, action] of Object.entries(configurable(mac)))
        expect(KEYS[key], `${action} on ${key}`).toBeUndefined();
  });

  it("has the editor take exactly the keys the table gives it", async () => {
    const takes = await probeEditor();
    for (const [key, row] of Object.entries(KEYS)) {
      const editor = PLATFORMS.some((platform) => row[platform] === "editor");
      expect(takes.has(key), `${key} (${row.does})`).toBe(editor);
    }
  });

  it("has the window's handler take no key the editor needs", async () => {
    const takes = await probeEditor();
    for (const platform of PLATFORMS) {
      const window = new Set([
        ...windowKeys(platform),
        ...Object.keys(configurable(platform === "macos")),
      ]);
      for (const key of takes.keys())
        expect(window.has(key), `${key} on ${platform}`).toBe(false);
    }
  });
});
