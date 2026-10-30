import { readFileSync } from "node:fs";

// Test-only: the native menu's keys as src-tauri writes them, read from
// its source, for tests that check the frontend against it.

export type Platform = "macos" | "windows" | "linux";

const rust = (file: string) =>
  readFileSync(`src-tauri/src/${file}`, "utf8").replace(/\r\n/g, "\n");
const MENU_RS = rust("menu.rs");
const BUILD_RS = rust("menu/build.rs");

/** The id each `X_ID` constant stands for. */
const ids = Object.fromEntries(
  [...MENU_RS.matchAll(/const (\w+_ID): &str = "([^"]+)";/g)].map((m) => [
    m[1],
    m[2],
  ]),
);

const combo = (accelerator: string) =>
  accelerator.toLowerCase().replace("cmdorctrl", "mod");

/** The menu items with a fixed accelerator, per platform: build.rs's
 *  builders, followed variable by variable, and MAC_EDIT_ITEMS. */
export function nativeAccelerators(platform: Platform): Map<string, string> {
  const consts = Object.fromEntries(
    [...BUILD_RS.matchAll(/const (\w+): &str = "([^"]+)";/g)].map((m) => [
      m[1],
      m[2],
    ]),
  );
  const out = new Map<string, string>();
  const idOf = new Map<string, string>();
  // One `let` statement at a time, with the cfg line above it.
  const statements = BUILD_RS.split(/;\n/);
  for (const statement of statements) {
    const cfg = statement.match(
      /#\[cfg\((not\()?(windows|target_os = "macos")\)?\)\]\s*let/,
    );
    if (cfg) {
      const os = cfg[2] === "windows" ? "windows" : "macos";
      const applies = cfg[1] ? platform !== os : platform === os;
      if (!applies) continue;
    }
    const assign = statement.match(/let (\w+) =\s*([\s\S]*)$/);
    if (!assign) continue;
    const [, name, value] = assign;
    const from = value.match(/^(\w+)\s*\./)?.[1];
    const id =
      value.match(/(?:with_id|item)\(\s*(\w+_ID)\b/)?.[1] ??
      (from ? idOf.get(from) : undefined);
    if (id) idOf.set(name, id);
    else idOf.delete(name);
    const accelerator = value.match(/\.accelerator\((?:"([^"]+)"|(\w+))\)/);
    if (id && accelerator)
      out.set(combo(accelerator[1] ?? consts[accelerator[2]]), ids[id]);
  }
  if (platform === "macos")
    for (const m of MENU_RS.matchAll(/\("([\w-]+)", "[^"]+", "([^"]+)"\)/g))
      out.set(combo(m[2]), m[1]);
  return out;
}

/** Which of muda's predefined Undo, Redo and Select All a Mac's menu
 *  builds: each takes its key before the page, running WebKit's own
 *  action. Each is built in a statement under a cfg line, or none. */
export function predefinedOnMac(): string[] {
  return ["undo", "redo", "select_all"].filter((name) =>
    BUILD_RS.split(/;\n/).some(
      (statement) =>
        statement.includes(`.${name}_with_text(`) &&
        !statement.includes('#[cfg(not(target_os = "macos"))]'),
    ),
  );
}

/** The window event each menu id is sent as, from menu.rs's dispatch;
 *  null when the backend acts itself. */
export function eventOf(id: string): string | null {
  const constant = Object.keys(ids).find((key) => ids[key] === id);
  const branch = constant
    ? MENU_RS.match(
        new RegExp(`id == ${constant} \\{([\\s\\S]*?)\\n    \\}`),
      )?.[1]
    : null;
  if (branch) return branch.match(/"(menu-[a-z-]+)"/)?.[1] ?? null;
  // MAC_EDIT_ITEMS go out as menu-<id>.
  if (MENU_RS.includes(`("${id}", `)) return `menu-${id}`;
  return null;
}
