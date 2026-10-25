/**
 * A plugin's manifest, `textus-plugin.json` (docs/design/plugins.md §1-2):
 * who it is, what it adds and what it needs. Read and checked here before
 * any of the plugin runs, so Settings can show what it adds and asks for
 * from the manifest alone.
 *
 * Strings a user sees (a command's title, a setting's description) may be
 * `%key%`, looked up in the manifest's `l10n` for the UI language, then
 * English, as VS Code's package.nls.json does.
 */

/** A permission, as the manifest names it. `network:<host>` names one
 *  host (`*.domain` for its subdomains, `host:port`, or `*` for any). */
export type Permission =
  | "document.read"
  | "document.propose"
  | "workspace.read"
  | "workspace.write"
  | "clipboard"
  | "editor.input"
  | "project.data"
  | "ai.tools"
  | `network:${string}`;

const PLAIN_PERMISSIONS = [
  "document.read",
  "document.propose",
  "workspace.read",
  "workspace.write",
  "clipboard",
  "editor.input",
  "project.data",
  "ai.tools",
] as const;

export function isPermission(value: unknown): value is Permission {
  if (typeof value !== "string") return false;
  if ((PLAIN_PERMISSIONS as readonly string[]).includes(value)) return true;
  const host = value.startsWith("network:") && value.slice("network:".length);
  return !!host && /^(\*|(\*\.)?[a-z0-9.-]+(:\d{1,5})?)$/i.test(host);
}

export interface CommandContribution {
  command: string;
  title: string;
}

export interface KeybindingContribution {
  command: string;
  /** As Settings writes combos: "mod+shift+k". */
  key: string;
}

/** Where a command is listed: the editor's right-click menu, the Plugins
 *  menu (the menu bar's on macOS, the app menu's elsewhere), and the menu
 *  of background mode's icon in the tray or menu bar - there with no
 *  window open, which it opens first. */
export type MenuId = "editor/context" | "app/plugins" | "app/tray";
export const MENU_IDS: readonly MenuId[] = [
  "editor/context",
  "app/plugins",
  "app/tray",
];

/** A Textus setting a plugin needs on to do all it does. Settings › Extensions › Plugins
 *  says which, and offers to turn it on (requirements.ts). */
export type RequiredSetting = "runInBackground";
export const REQUIRED_SETTINGS: readonly RequiredSetting[] = [
  "runInBackground",
];

export interface Requirement {
  setting: RequiredSetting;
  /** Why, in the plugin's words: "%needsBackground%". */
  reason?: string;
}

export interface MenuContribution {
  command: string;
  /** "editorHasSelection", "fileExtension == .pdf" - see when.ts. */
  when?: string;
}

/** A tab in the sidebar, its panel a webview the plugin fills
 *  (registerWebviewViewProvider). */
export interface SidebarTabContribution {
  id: string;
  title: string;
  /** An SVG in the plugin's folder, drawn in the current text colour. */
  icon?: string;
}

/** A view the plugin opens in a tab of its own (window.openView). */
export interface ViewContribution {
  id: string;
  title: string;
}

/** A file type the plugin opens in a tab (registerCustomEditorProvider). */
export interface CustomEditorContribution {
  viewType: string;
  displayName: string;
  /** Glob-like file name patterns: "*.pdf", "*.kanban.md". */
  filenamePatterns: string[];
  /** "default" opens matching files in it; "option" only offers it in
   *  the file's Open With. */
  priority: "default" | "option";
}

export type SettingType = "boolean" | "string" | "number" | "enum";

export interface SettingContribution {
  key: string;
  type: SettingType;
  default: boolean | string | number;
  title: string;
  description?: string;
  /** For "enum": the values, and what each is called. */
  options?: { value: string; label: string }[];
  /** For "string": several lines, in a box under its title (Vim's key
   *  mappings). */
  multiline?: boolean;
}

export interface ThemeContribution {
  id: string;
  label: string;
  /** The CSS file in the plugin's folder. */
  path: string;
}

/** A tool the plugin gives Textus AI (with ai.tools): what the model is
 *  told, and the arguments it takes as a JSON schema; the plugin runs it
 *  with textus.ai.registerTool. */
export interface AiToolContribution {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Where a plugin suggests completions as you type (with document.read):
 *  in a formula, in the text, or both, once the words before the caret
 *  match `pattern` (a regular expression, anchored at the caret). The
 *  plugin answers with textus.editor.registerCompletionProvider(id). */
export interface CompletionContribution {
  id: string;
  where: "math" | "text" | "any";
  pattern: string;
}

/** The links a plugin opens when one is Ctrl/Cmd+clicked in a document:
 *  a URL matching `pattern` (a regular expression) runs `command`, its
 *  own, with the URL - instead of the system's browser. */
export interface LinkContribution {
  pattern: string;
  command: string;
}

export interface Contributes {
  commands: CommandContribution[];
  keybindings: KeybindingContribution[];
  menus: Partial<Record<MenuId, MenuContribution[]>>;
  sidebarTabs: SidebarTabContribution[];
  views: ViewContribution[];
  customEditors: CustomEditorContribution[];
  settings: SettingContribution[];
  /** A page of its own in Settings, a webview (registerSettingsPage). */
  settingsPage: { title: string } | null;
  themes: ThemeContribution[];
  aiTools: AiToolContribution[];
  completions: CompletionContribution[];
  links: LinkContribution[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  publisher: string;
  /** Who made it, as a name to show ("CatVinci Studio"); the publisher
   *  id where there is none. */
  author?: string;
  description: string;
  icon?: string;
  license?: string;
  repository?: string;
  /** The Textus versions it works with: "^1.2.0", ">=1.2.0". */
  engine: string;
  /** Its code, run in the plugin host; none for a plugin that only adds
   *  themes. */
  main?: string[];
  activationEvents: string[];
  permissions: Permission[];
  requires: Requirement[];
  contributes: Contributes;
  /** `%key%` strings, by language. */
  l10n: Record<string, Record<string, string>>;
}

/** Why a manifest was refused, in English: it is shown as is in Settings
 *  under the plugin's name, for its author. */
export class ManifestError extends Error {}

const ID = /^[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
/** A contributed id: the plugin's own namespace, then a name. */
const LOCAL_ID = /^[a-z0-9][a-z0-9.-]*$/i;

type Json = Record<string, unknown>;

function object(value: unknown, what: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ManifestError(`${what} must be an object.`);
  return value as Json;
}

function list(value: unknown, what: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ManifestError(`${what} must be a list.`);
  return value;
}

function text(value: unknown, what: string, optional = false): string {
  if (optional && value === undefined) return "";
  if (typeof value !== "string" || !value.trim())
    throw new ManifestError(`${what} must be a string.`);
  return value;
}

/** A contributed id must start with the plugin's id, so two plugins can't
 *  take each other's commands or views. */
function ownId(value: unknown, pluginId: string, what: string): string {
  const id = text(value, what);
  if (!id.startsWith(`${pluginId}.`) || !LOCAL_ID.test(id))
    throw new ManifestError(`${what} "${id}" must start with "${pluginId}.".`);
  return id;
}

/** `main`: one file, or several run in order (a plugin's shared code
 *  first) - the host takes no imports. */
function parseMain(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const files = typeof value === "string" ? [value] : list(value, "main");
  return files.map((f, i) => text(f, `main[${i}]`));
}

function parseSetting(raw: unknown, at: string): SettingContribution {
  const s = object(raw, at);
  const type = s.type;
  if (
    type !== "boolean" &&
    type !== "string" &&
    type !== "number" &&
    type !== "enum"
  )
    throw new ManifestError(
      `${at}.type must be boolean, string, number or enum.`,
    );
  const options =
    type === "enum"
      ? list(s.options, `${at}.options`).map((o, i) => {
          const opt = object(o, `${at}.options[${i}]`);
          return {
            value: text(opt.value, `${at}.options[${i}].value`),
            label: text(opt.label, `${at}.options[${i}].label`),
          };
        })
      : undefined;
  const fallback = s.default;
  const expected = type === "enum" ? "string" : type;
  if (typeof fallback !== expected)
    throw new ManifestError(`${at}.default must be a ${expected}.`);
  if (options && !options.some((o) => o.value === fallback))
    throw new ManifestError(`${at}.default must be one of its options.`);
  return {
    key: text(s.key, `${at}.key`),
    type,
    default: fallback as SettingContribution["default"],
    title: text(s.title, `${at}.title`),
    description: text(s.description, `${at}.description`, true) || undefined,
    options,
    ...(type === "string" && s.multiline === true ? { multiline: true } : {}),
  };
}

function parseContributes(raw: unknown, id: string): Contributes {
  const c = raw === undefined ? {} : object(raw, "contributes");
  const commands = list(c.commands, "contributes.commands").map((x, i) => {
    const o = object(x, `contributes.commands[${i}]`);
    return {
      command: ownId(o.command, id, `contributes.commands[${i}].command`),
      title: text(o.title, `contributes.commands[${i}].title`),
    };
  });
  const declared = new Set(commands.map((x) => x.command));
  const declaredCommand = (value: unknown, what: string) => {
    const command = text(value, what);
    if (!declared.has(command))
      throw new ManifestError(
        `${what} "${command}" is not in contributes.commands.`,
      );
    return command;
  };
  const keybindings = list(c.keybindings, "contributes.keybindings").map(
    (x, i) => {
      const o = object(x, `contributes.keybindings[${i}]`);
      return {
        command: declaredCommand(
          o.command,
          `contributes.keybindings[${i}].command`,
        ),
        key: text(o.key, `contributes.keybindings[${i}].key`).toLowerCase(),
      };
    },
  );
  const menus: Contributes["menus"] = {};
  const rawMenus =
    c.menus === undefined ? {} : object(c.menus, "contributes.menus");
  for (const [where, items] of Object.entries(rawMenus)) {
    if (!(MENU_IDS as readonly string[]).includes(where))
      throw new ManifestError(`contributes.menus: no menu "${where}".`);
    menus[where as MenuId] = list(items, `contributes.menus.${where}`).map(
      (x, i) => {
        const o = object(x, `contributes.menus.${where}[${i}]`);
        return {
          command: declaredCommand(
            o.command,
            `contributes.menus.${where}[${i}].command`,
          ),
          when:
            text(o.when, `contributes.menus.${where}[${i}].when`, true) ||
            undefined,
        };
      },
    );
  }
  const sidebarTabs = list(c.sidebarTabs, "contributes.sidebarTabs").map(
    (x, i) => {
      const o = object(x, `contributes.sidebarTabs[${i}]`);
      return {
        id: ownId(o.id, id, `contributes.sidebarTabs[${i}].id`),
        title: text(o.title, `contributes.sidebarTabs[${i}].title`),
        icon:
          text(o.icon, `contributes.sidebarTabs[${i}].icon`, true) || undefined,
      };
    },
  );
  const views = list(c.views, "contributes.views").map((x, i) => {
    const o = object(x, `contributes.views[${i}]`);
    return {
      id: ownId(o.id, id, `contributes.views[${i}].id`),
      title: text(o.title, `contributes.views[${i}].title`),
    };
  });
  const customEditors = list(c.customEditors, "contributes.customEditors").map(
    (x, i) => {
      const at = `contributes.customEditors[${i}]`;
      const o = object(x, at);
      const patterns = list(o.filenamePatterns, `${at}.filenamePatterns`).map(
        (p, j) => text(p, `${at}.filenamePatterns[${j}]`).toLowerCase(),
      );
      if (!patterns.length)
        throw new ManifestError(`${at}.filenamePatterns is empty.`);
      return {
        viewType: ownId(o.viewType, id, `${at}.viewType`),
        displayName: text(o.displayName, `${at}.displayName`),
        filenamePatterns: patterns,
        priority:
          o.priority === "option" ? ("option" as const) : ("default" as const),
      };
    },
  );
  const settings = list(c.settings, "contributes.settings").map((x, i) =>
    parseSetting(x, `contributes.settings[${i}]`),
  );
  const page =
    c.settingsPage === undefined
      ? null
      : object(c.settingsPage, "contributes.settingsPage");
  const themes = list(c.themes, "contributes.themes").map((x, i) => {
    const o = object(x, `contributes.themes[${i}]`);
    return {
      id: ownId(o.id, id, `contributes.themes[${i}].id`),
      label: text(o.label, `contributes.themes[${i}].label`),
      path: text(o.path, `contributes.themes[${i}].path`),
    };
  });
  const aiTools = list(c.aiTools, "contributes.aiTools").map((x, i) => {
    const o = object(x, `contributes.aiTools[${i}]`);
    const name = text(o.name, `contributes.aiTools[${i}].name`);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(name))
      throw new ManifestError(
        `contributes.aiTools[${i}].name "${name}" must be letters, digits, _ or -.`,
      );
    return {
      name,
      description: text(o.description, `contributes.aiTools[${i}].description`),
      parameters:
        o.parameters === undefined
          ? { type: "object", properties: {} }
          : object(o.parameters, `contributes.aiTools[${i}].parameters`),
    };
  });
  const completions = list(c.completions, "contributes.completions").map(
    (x, i) => {
      const at = `contributes.completions[${i}]`;
      const o = object(x, at);
      const where =
        o.where === undefined ? "any" : text(o.where, `${at}.where`);
      if (where !== "math" && where !== "text" && where !== "any")
        throw new ManifestError(`${at}.where must be "math", "text" or "any".`);
      const pattern = text(o.pattern, `${at}.pattern`);
      try {
        new RegExp(pattern);
      } catch {
        throw new ManifestError(`${at}.pattern is not a regular expression.`);
      }
      return {
        id: ownId(o.id, id, `${at}.id`),
        where: where as CompletionContribution["where"],
        pattern,
      };
    },
  );
  const links = list(c.links, "contributes.links").map((x, i) => {
    const at = `contributes.links[${i}]`;
    const o = object(x, at);
    const pattern = text(o.pattern, `${at}.pattern`);
    try {
      new RegExp(pattern);
    } catch {
      throw new ManifestError(`${at}.pattern is not a regular expression.`);
    }
    return { pattern, command: declaredCommand(o.command, `${at}.command`) };
  });
  return {
    aiTools,
    completions,
    links,
    commands,
    keybindings,
    menus,
    sidebarTabs,
    views,
    customEditors,
    settings,
    settingsPage: page && {
      title: text(page.title, "contributes.settingsPage.title"),
    },
    themes,
  };
}

/** The manifest in `raw` (the file's text or its parsed JSON), checked;
 *  throws ManifestError saying what is wrong. */
export function parseManifest(raw: string | unknown): PluginManifest {
  let json: unknown = raw;
  if (typeof raw === "string") {
    try {
      json = JSON.parse(raw);
    } catch (err) {
      throw new ManifestError(`textus-plugin.json is not JSON: ${String(err)}`);
    }
  }
  const m = object(json, "textus-plugin.json");
  const id = text(m.id, "id");
  if (!ID.test(id))
    throw new ManifestError(`id "${id}" must be publisher.name, lowercase.`);
  const version = text(m.version, "version");
  if (!VERSION.test(version))
    throw new ManifestError(`version "${version}" must be like 1.0.0.`);
  const engines = object(m.engines ?? {}, "engines");
  const permissions = list(m.permissions, "permissions").map((p) => {
    if (!isPermission(p))
      throw new ManifestError(`No permission "${String(p)}".`);
    return p;
  });
  const l10n: PluginManifest["l10n"] = {};
  if (m.l10n !== undefined)
    for (const [lang, table] of Object.entries(object(m.l10n, "l10n"))) {
      const strings = object(table, `l10n.${lang}`);
      l10n[lang] = Object.fromEntries(
        Object.entries(strings).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    }
  return {
    id,
    name: text(m.name, "name"),
    version,
    publisher: text(m.publisher, "publisher"),
    author: text(m.author, "author", true) || undefined,
    description: text(m.description, "description", true),
    icon: text(m.icon, "icon", true) || undefined,
    license: text(m.license, "license", true) || undefined,
    repository: text(m.repository, "repository", true) || undefined,
    engine: text(engines.textus, "engines.textus"),
    main: parseMain(m.main),
    activationEvents: list(m.activationEvents, "activationEvents").map((e, i) =>
      text(e, `activationEvents[${i}]`),
    ),
    permissions,
    requires: list(m.requires, "requires").map((r, i) => {
      const need = object(r, `requires[${i}]`);
      const setting = text(need.setting, `requires[${i}].setting`);
      if (!(REQUIRED_SETTINGS as readonly string[]).includes(setting))
        throw new ManifestError(
          `requires[${i}].setting "${setting}" is not one of ${REQUIRED_SETTINGS.join(", ")}.`,
        );
      return {
        setting: setting as RequiredSetting,
        reason: text(need.reason, `requires[${i}].reason`, true) || undefined,
      };
    }),
    contributes: parseContributes(m.contributes, id),
    l10n,
  };
}

/** `%key%` looked up for `lang` (its own, then its base language's, then
 *  English); anything else as written. */
export function localize(
  manifest: Pick<PluginManifest, "l10n">,
  value: string,
  lang: string,
): string {
  const key = /^%([^%]+)%$/.exec(value)?.[1];
  if (!key) return value;
  return (
    manifest.l10n[lang]?.[key] ??
    manifest.l10n[lang.split("-")[0]]?.[key] ??
    manifest.l10n.en?.[key] ??
    key
  );
}

function versionParts(version: string): [number, number, number, string] {
  const [core, pre = ""] = version.split("-", 2);
  const [major = 0, minor = 0, patch = 0] = core.split(".").map(Number);
  return [major, minor, patch, pre];
}

/** -1, 0 or 1, as semver orders them: a pre-release before its release. */
export function compareVersions(a: string, b: string): number {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < 3; i++)
    if (x[i] !== y[i]) return (x[i] as number) < (y[i] as number) ? -1 : 1;
  if (x[3] === y[3]) return 0;
  if (!x[3]) return 1;
  if (!y[3]) return -1;
  return x[3] < y[3] ? -1 : 1;
}

/**
 * Whether Textus `version` satisfies `range`: `^1.3.0` (1.3.0 up to, not
 * including, 2.0.0), `>=1.3.0`, `1.3.x`, or an exact version. Textus's own
 * pre-releases count as their release, so a plugin for `^1.3.0` runs on
 * 1.3.0-beta.1 - unless the range names a pre-release itself
 * (`>=1.3.0-beta.2`, for an interface beta.2 brought): then the betas are
 * told apart, and beta.1 is too early.
 */
export function engineSatisfied(range: string, version: string): boolean {
  const r = range.trim();
  if (r === "*") return true;
  const base = r.replace(/^(>=|\^)/, "").trim();
  const release = base.includes("-") ? version : version.split("-")[0];
  if (r.startsWith(">=")) return compareVersions(release, base) >= 0;
  if (r.startsWith("^")) {
    const [major] = versionParts(base);
    return (
      compareVersions(release, base) >= 0 && versionParts(release)[0] === major
    );
  }
  const wild = /^(\d+)\.(\d+)\.x$/.exec(r);
  if (wild) {
    const [major, minor] = versionParts(release);
    return major === Number(wild[1]) && minor === Number(wild[2]);
  }
  return compareVersions(release, r) === 0;
}

/** Whether `fileName` matches a custom editor's pattern: `*` for any run
 *  of characters, case left aside. */
export function matchesFilename(pattern: string, fileName: string): boolean {
  const re = new RegExp(
    `^${pattern
      .toLowerCase()
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  );
  return re.test(fileName.toLowerCase());
}
