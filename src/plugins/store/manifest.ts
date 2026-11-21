import { isHiddenFilePath } from "./hidden-files";
import { pluginString } from "../host/plugin-string";
import PERMISSIONS from "./permissions.json";
/**
 * A plugin's manifest, `textus-plugin.json`, read and checked before any of
 * the plugin runs. User-facing strings may be `%key%`, looked up in `l10n`.
 */

import { parseContributes, parseMain } from "./manifest-parse";
import { ManifestError, list, object, text } from "./manifest-json";

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
  | "ai.model"
  | "comments"
  | "notifications"
  | "background"
  | "agents"
  | "appearance"
  | "git.commit"
  | "git.sync"
  | "ssh";
export type PluginPlatform = "desktop" | "ios";

/** A permission, as the manifest names it. `network:<host>` names one
 *  host (`*.domain` for its subdomains, `host:port`, or `*` for any);
 *  `commands:<plugin id>` lets it run that plugin's listed commands;
 *  `hidden:<path>` lets it read that hidden file of the open folder. */
export type Permission =
  | PlainPermission
  | `network:${string}`
  | `commands:${string}`
  | `hidden:${string}`;

export function isPermission(value: unknown): value is Permission {
  if (typeof value !== "string") return false;
  if ((PLAIN_PERMISSIONS as readonly string[]).includes(value)) return true;
  if (value.startsWith("commands:"))
    return ID.test(value.slice("commands:".length));
  if (value.startsWith("hidden:"))
    return isHiddenFilePath(value.slice("hidden:".length));
  const host = value.startsWith("network:") && value.slice("network:".length);
  return !!host && /^(\*|(\*\.)?[a-z0-9.-]+(:\d{1,5})?)$/i.test(host);
}

import { REQUIRED_SETTINGS } from "./manifest-types";
import type { PluginManifest, RequiredSetting } from "./manifest-types";

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
