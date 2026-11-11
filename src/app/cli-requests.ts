import { tabElement } from "../engine/layout/tab-element";
import { currentStrings } from "../i18n/current";
import type { Settings } from "../prefs/SettingsContext";
import { BUILTIN_CONTENT_THEMES } from "../theme/builtin-themes";
import { loadPlugins } from "../plugins/manager";
import { installPlugin, setPluginEnabled } from "../plugins/plugin-switches";
import { pluginName, pluginsSnapshot } from "../plugins/store/plugin-records";
import { installFromCatalog, loadCatalog } from "../plugins/store/catalog";
import { emitToWindow } from "../platform/events";
import { thisWindow } from "../platform/this-window";
import { runCommand } from "./commands";
import { runMenuAction } from "./menu/app-menu-actions";
import { paletteNow, type PaletteEntry } from "./command-palette";

/**
 * The `textus` commands a window answers: the command palette, plugins,
 * themes and export. Rust's listener (src-tauri/src/cli/app.rs) hands them
 * over; plugins' tools and skills it answers itself.
 */

/** Shape shared with CliRequestEvent in src-tauri/src/cli/app.rs. */
export interface CliRequest {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  json: boolean;
}

export interface CliAnswer {
  out: string;
  err: string;
  exit: number;
}

/** What the window gives the commands, read when they run. */
export interface CliWindow {
  openPath: (path: string) => Promise<void>;
  activePath: string | null;
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
}

type Handler = (
  request: CliRequest,
  window: () => CliWindow,
) => Promise<CliAnswer>;

const ok = (out: string): CliAnswer => ({ out, err: "", exit: 0 });
const fail = (err: string, exit = 1): CliAnswer => ({ out: "", err, exit });

/** Rows as aligned columns, or as JSON objects with `--json`. */
export function rows(
  request: Pick<CliRequest, "json">,
  list: Record<string, string>[],
): CliAnswer {
  if (request.json) return ok(JSON.stringify(list));
  const keys = Object.keys(list[0] ?? {});
  const widths = keys.map((k) => Math.max(...list.map((r) => r[k].length)));
  return ok(
    list
      .map((r) =>
        keys
          .map((k, i) => (i < keys.length - 1 ? r[k].padEnd(widths[i]) : r[k]))
          .join("  ")
          .trimEnd(),
      )
      .join("\n"),
  );
}

/** A palette entry's id: its command's, or its menu item's. */
export function entryId({ run }: PaletteEntry): string {
  if ("command" in run) return run.command;
  if ("local" in run.menu) return run.menu.local;
  return run.menu.native.replace(/^plugin-command:/, "");
}

const commands: Handler = async (request) => {
  const [verb = "list", id, ...rest] = request.args;
  const entries = paletteNow();
  if (verb === "list" && id === undefined)
    return rows(
      request,
      entries.map((e) => ({
        id: entryId(e),
        label: e.where ? `${e.label} (${e.where})` : e.label,
      })),
    );
  if (verb !== "run" || !id || rest.length > 0)
    return fail("Usage: textus commands [list | run <id>]", 2);
  const entry = entries.find((e) => entryId(e) === id);
  if (!entry) return fail(`No command '${id}' can run now.`);
  if ("command" in entry.run) runCommand(entry.run.command);
  else runMenuAction(entry.run.menu);
  return ok("");
};

const theme: Handler = async (request, window) => {
  const [verb = "list", wanted, ...rest] = request.args;
  const t = currentStrings();
  const { themeId, userThemes } = window().settings;
  const themes = [
    ...BUILTIN_CONTENT_THEMES.map((b) => ({ id: b.id, name: t[b.nameKey] })),
    ...userThemes.map((u) => ({ id: u.id, name: u.name })),
  ];
  if (verb === "list" && wanted === undefined)
    return rows(
      request,
      themes.map((th) => ({
        current: th.id === themeId ? "*" : "",
        id: th.id,
        name: th.name,
      })),
    );
  if (verb !== "set" || !wanted || rest.length > 0)
    return fail("Usage: textus theme list | set <id>", 2);
  const lower = wanted.toLowerCase();
  const found = themes.find(
    (th) => th.id === wanted || th.name.toLowerCase() === lower,
  );
  if (!found) return fail(`No theme '${wanted}'. See 'textus theme list'.`);
  window().setSettings({ themeId: found.id });
  return ok("");
};

/** A path the user typed, against the terminal's folder. */
export function againstCwd(path: string, cwd: string): string {
  if (/^([a-zA-Z]:)?[\\/]/.test(path)) return path;
  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  return `${cwd.replace(/[\\/]+$/, "")}${sep}${path}`;
}

const plugin: Handler = async (request) => {
  const [verb = "list", id, ...rest] = request.args;
  if (verb === "list" && id === undefined) {
    await loadPlugins();
    return rows(
      request,
      pluginsSnapshot().records.map((r) => ({
        id: r.id,
        version: r.manifest?.version ?? "",
        status: r.status,
        name: pluginName(r),
      })),
    );
  }
  if (
    !id ||
    rest.length > 0 ||
    !["install", "enable", "disable"].includes(verb)
  )
    return fail(
      "Usage: textus plugin list | install <id or path> | enable <id> | disable <id>",
      2,
    );
  if (verb === "install") {
    if (/[\\/]/.test(id) || id.startsWith(".")) {
      const installed = await installPlugin(againstCwd(id, request.cwd));
      await setPluginEnabled(installed, true);
      return ok(installed);
    }
    await loadCatalog();
    await installFromCatalog(id);
    return ok(id);
  }
  const record = pluginsSnapshot().records.find((r) => r.id === id);
  if (!record) return fail(`No plugin '${id}' is installed.`);
  await setPluginEnabled(id, verb === "enable");
  const now = pluginsSnapshot().records.find((r) => r.id === id)?.status;
  if ((now === "on") !== (verb === "enable"))
    return fail(`${id} is ${now ?? "gone"}.`);
  return ok("");
};

/** How long the document has to open in the editor before it exports. */
const EDITOR_WITHIN_MS = 15_000;

const exportDocument: Handler = async (request, window) => {
  const [path, format] = request.args;
  await window().openPath(path);
  const deadline = Date.now() + EDITOR_WITHIN_MS;
  while (
    window().activePath !== path ||
    !tabElement()?.querySelector(".milkdown")
  ) {
    if (Date.now() > deadline)
      return fail(`${path} didn't open in Textus's editor.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const [event, payload] =
    format === "pdf" || format === "html"
      ? [`menu-export-${format}`, undefined]
      : ["menu-export-pandoc", format];
  const { label } = thisWindow();
  await emitToWindow({ kind: "WebviewWindow", label }, event, payload);
  return ok("");
};

const HANDLERS: Record<string, Handler> = {
  commands,
  theme,
  plugin,
  export: exportDocument,
};

export async function answerCliRequest(
  request: CliRequest,
  window: () => CliWindow,
): Promise<CliAnswer> {
  const handler = HANDLERS[request.command];
  if (!handler) return fail(`'${request.command}' is not a textus command.`, 2);
  try {
    return await handler(request, window);
  } catch (err) {
    return fail(String((err as Error)?.message ?? err));
  }
}
