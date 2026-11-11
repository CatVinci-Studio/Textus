import { pluginString } from "../host/plugin-string";
import PERMISSIONS from "./permissions.json";
/**
 * A plugin's manifest, `textus-plugin.json`, read and checked before any of
 * the plugin runs. User-facing strings may be `%key%`, looked up in `l10n`.
 */

import {
  ManifestError,
  list,
  object,
  parseContributes,
  parseMain,
  text,
} from "./manifest-parse";

/** The permissions without a host, and the platforms: one list with the
 *  backend's (plugins/manifest.rs reads permissions.json too). */
const PLAIN_PERMISSIONS = PERMISSIONS.plain as readonly PlainPermission[];
const PLUGIN_PLATFORMS = PERMISSIONS.platforms as readonly PluginPlatform[];

type PlainPermission =
  | "editor.read"
  | "editor.write"
  | "editor.propose"
  | "editor.input"
  | "files.read"
  | "files.write"
  | "clipboard"
  | "project.data"
  | "ai.tools"
  | "notifications"
  | "background"
  | "agents";
export type PluginPlatform = "desktop" | "ios";

/** A permission, as the manifest names it. `network:<host>` names one
 *  host (`*.domain` for its subdomains, `host:port`, or `*` for any);
 *  `commands:<plugin id>` lets it run that plugin's listed commands. */
export type Permission =
  PlainPermission | `network:${string}` | `commands:${string}`;

export function isPermission(value: unknown): value is Permission {
  if (typeof value !== "string") return false;
  if ((PLAIN_PERMISSIONS as readonly string[]).includes(value)) return true;
  if (value.startsWith("commands:"))
    return ID.test(value.slice("commands:".length));
  const host = value.startsWith("network:") && value.slice("network:".length);
  return !!host && /^(\*|(\*\.)?[a-z0-9.-]+(:\d{1,5})?)$/i.test(host);
}

export interface CommandContribution {
  command: string;
  title: string;
  /** Runs one of Textus's commands with these arguments, at once and with
   *  no code of the plugin's: what a / item or a key must do before the
   *  next key comes. */
  runs?: { command: string; args: unknown[] };
}

export interface KeybindingContribution {
  command: string;
  /** As Settings writes combos: "mod+shift+k". */
  key: string;
}

/** Where a command is listed: the editor's context menu, a file's or tab's
 *  (given its path), a view's title buttons, a floating view's right-click
 *  menu, the Plugins menu, or the tray menu (with no window open, which it
 *  opens first). */
export type MenuId =
  | "editor/context"
  | "editor/slash"
  | "file/context"
  | "tab/context"
  | "view/title"
  | "floating/context"
  | "app/plugins"
  | "app/tray";

/** A Textus setting a plugin needs on to do all it does. */
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
  /** "editorHasSelection", "fileExtension == .pdf". */
  when?: string;
  /** For "view/title": an icon (one of the app's, or an SVG of the
   *  plugin's) in place of the title. */
  icon?: string;
}

/** A view is drawn by Textus from the plugin's items, or is a page of the
 *  plugin's own. */
export type ViewType = "list" | "webview";

export interface SidebarTabContribution {
  id: string;
  title: string;
  type: ViewType;
  /** An SVG in the plugin's folder, drawn in the current text colour. */
  icon?: string;
}

/** A view the plugin opens in a tab of its own. */
export interface ViewContribution {
  id: string;
  title: string;
  type: ViewType;
}

/** Code blocks of a language the plugin draws in the document: ```tasks. */
export interface CodeBlockContribution {
  language: string;
  /** What the block is called where Textus names it ("Task query"). */
  title?: string;
  /** "none": the block sits on the page without the box drawn round a
   *  figure - for one that reads as part of the document, such as a table. */
  frame?: "none";
}

/** A file type the plugin opens in a tab. */
export interface CustomEditorContribution {
  viewType: string;
  displayName: string;
  /** Glob-like file name patterns: "*.pdf", "*.kanban.md". */
  filenamePatterns: string[];
  /** Front matter keys that make a Markdown document the plugin's: a .md
   *  whose front matter has one ("kanban-plugin: board") opens in it. */
  frontMatter: string[];
  /** "default" opens matching files in it; "option" only offers it in
   *  the file's Open With. */
  priority: "default" | "option";
}

export type SettingType =
  "boolean" | "string" | "number" | "enum" | "color" | "list" | "button";

export interface SettingContribution {
  key: string;
  type: SettingType;
  /** None for a "button"; a "#rrggbb" for a "color", strings for a "list". */
  default?: boolean | string | number | string[];
  title: string;
  description?: string;
  /** A heading the setting goes under; the ones after it share it until
   *  another is named. */
  group?: string;
  /** Shown only while another setting is so: "legend", "!legend",
   *  "style == dark", "style != dark". */
  when?: string;
  /** For "enum": the values, and what each is called. */
  options?: { value: string; label: string }[];
  /** For "string": several lines, in a box under its title. */
  multiline?: boolean;
  /** For "number": the least and most it takes. */
  min?: number;
  max?: number;
  /** For "button": the command it runs. */
  command?: string;
}

export interface ThemeContribution {
  id: string;
  label: string;
  path: string;
}

/** A tool the plugin gives Textus AI: what the model is told and its
 *  arguments as a JSON schema. */
export interface AiToolContribution {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Where a plugin suggests completions as you type: in a formula, the text or
 *  both, once the words before the caret match `pattern` (anchored there). */
export interface CompletionContribution {
  id: string;
  where: "math" | "text" | "any";
  /** Anchored at the caret; its last capture group is the query. */
  pattern: string;
  /** The panel group's heading ("%notes%"); the plugin's name without it. */
  title?: string;
}

/** Links a plugin opens on Ctrl/Cmd+click instead of the browser: a URL
 *  matching `pattern` runs its `command` with the URL. */
export interface LinkContribution {
  pattern: string;
  command: string;
}

/** Where a floating view may be: on the desktop, over every window, in
 *  Textus's window, or either, as the user picks. */
export type FloatingPlace = "desktop" | "window" | "either";

/** A small page of the plugin's that floats - a desk pet, a timer, a
 *  teleprompter - shown only when the user turns it on, moved where they
 *  like. `width` and `height` are its size in points. */
export interface FloatingViewContribution {
  id: string;
  title: string;
  width: number;
  height: number;
  place: FloatingPlace;
}

/** What a document can hold that a plugin works with, so Textus suggests it
 *  for a document that does: [[wikilinks]]. */
export type SuggestKind = "wikilinks";

/** What `![[...]]` embeds point at. */
export type EmbedKind = "note" | "heading" | "block";

/** `![[...]]` embeds whose content the plugin gives as Markdown; Textus
 *  draws it, read-only. Needs files.read. */
export interface EmbedContribution {
  id: string;
  targets: EmbedKind[];
}

/** The hover cards a plugin gives. */
export type HoverContribution = "document" | "link" | "citation";

/** An AI agent on the user's computer that Textus AI's panel can talk to
 *  (Agent Client Protocol over stdio): Claude Code, Codex… Needs `agents`.
 *  `{pluginDir}` in `args` and `env` is the plugin's own folder. */
export interface AgentContribution {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** How to install it and sign in, shown when it can't start. */
  setup?: string;
}

export interface Contributes {
  commands: CommandContribution[];
  keybindings: KeybindingContribution[];
  menus: Partial<Record<MenuId, MenuContribution[]>>;
  sidebarTabs: SidebarTabContribution[];
  views: ViewContribution[];
  customEditors: CustomEditorContribution[];
  settings: SettingContribution[];
  /** A page of its own in Settings, a webview. */
  settingsPage: { title: string } | null;
  themes: ThemeContribution[];
  aiTools: AiToolContribution[];
  completions: CompletionContribution[];
  embeds: EmbedContribution[];
  hovers: HoverContribution[];
  links: LinkContribution[];
  codeBlocks: CodeBlockContribution[];
  floatingViews: FloatingViewContribution[];
  agents: AgentContribution[];
  /** Suggested, once, for a document with these. */
  suggestFor: SuggestKind[];
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
  /** Where it runs. Unset, everywhere, unless it works in the background
   *  (background code, or requiring runInBackground): the desktop's only. */
  platforms: readonly PluginPlatform[];
  /** Its code, run in the plugin host; none for a themes-only plugin. */
  main?: string[];
  /** Code its scheduled jobs run, apart from `main` and without the editor
   *  or UI; it runs only with the background permission granted. */
  background?: string;
  activationEvents: string[];
  permissions: Permission[];
  requires: Requirement[];
  contributes: Contributes;
  /** `%key%` strings, by language. */
  l10n: Record<string, Record<string, string>>;
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** The manifest in `raw` (the file's text or its parsed JSON), checked;
 *  throws ManifestError saying what is wrong. Everything but `contributes`
 *  is checked again by `plugins::manifest::check` in Rust before a plugin is
 *  installed or loaded; change both. */
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
  const background = text(m.background, "background", true) || undefined;
  const requires = list(m.requires, "requires").map((r, i) => {
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
  });
  // Background code, or Textus kept running in the background: the desktop's.
  const inBackground =
    !!background || requires.some((r) => r.setting === "runInBackground");
  // An agent is a program on the computer: the desktop's too.
  const agents = permissions.includes("agents");
  const platforms: readonly PluginPlatform[] =
    m.platforms === undefined
      ? inBackground || agents
        ? ["desktop"]
        : PLUGIN_PLATFORMS
      : list(m.platforms, "platforms").map((p) => {
          if (!(PLUGIN_PLATFORMS as readonly unknown[]).includes(p))
            throw new ManifestError(
              `No platform "${String(p)}": desktop or ios.`,
            );
          return p as PluginPlatform;
        });
  if (inBackground && platforms.includes("ios"))
    throw new ManifestError(
      "The background is the desktop's only: platforms can't name ios.",
    );
  if (agents && platforms.includes("ios"))
    throw new ManifestError(
      "Agents are the desktop's only: platforms can't name ios.",
    );
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
  const contributes = parseContributes(m.contributes, id);
  if (contributes.embeds.length && !permissions.includes("files.read"))
    throw new ManifestError("contributes.embeds needs files.read.");
  if (contributes.agents.length && !permissions.includes("agents"))
    throw new ManifestError("contributes.agents needs agents.");
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
    platforms,
    main: parseMain(m.main),
    background,
    activationEvents: list(m.activationEvents, "activationEvents").map((e, i) =>
      text(e, `activationEvents[${i}]`),
    ),
    permissions,
    requires,
    contributes,
    l10n,
  };
}

/** `%key%` looked up for `lang` (pluginString's order); anything else as
 *  written. */
export function localize(
  manifest: Pick<PluginManifest, "l10n">,
  value: string,
  lang: string,
): string {
  const key = /^%([^%]+)%$/.exec(value)?.[1];
  return key ? pluginString(manifest.l10n, lang, key) : value;
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
 * Whether Textus `version` satisfies `range`: `^1.3.0`, `>=1.3.0`, `1.3.x`, or
 * exact. Textus pre-releases count as their release unless the range names a
 * pre-release itself; then they are told apart.
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
