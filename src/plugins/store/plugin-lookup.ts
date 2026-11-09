import { currentStrings } from "../../i18n/current";
import { PLUGIN_SETTINGS } from "../../app/menu/plugin-menu";
import { basename } from "../../utils/path";
import { localize, matchesFilename } from "./manifest";
import { claimKey, frontMatterClaim, ownerOf } from "../contributions/owners";
import {
  pluginsSnapshot,
  windowInfo,
  type PluginsSnapshot,
} from "./plugin-records";

/**
 * What the plugins on offer contribute, read from their manifests without
 * running them: a file's custom editor, the Plugins and tray menus' commands.
 */

/** The plugin that opens `path` in a tab of its own, if one is on: the
 *  owner of the first pattern that matches with priority "default". */
export function customEditorFor(
  path: string,
): { plugin: string; viewType: string; title: string } | null {
  if (!pluginsSnapshot().allOn) return null;
  const name = basename(path);
  for (const record of pluginsSnapshot().records) {
    if (record.status !== "on" || !record.manifest) continue;
    for (const editor of record.manifest.contributes.customEditors)
      if (
        editor.priority === "default" &&
        editor.filenamePatterns.some(
          (p) =>
            matchesFilename(p, name) &&
            (ownerOf(claimKey.editor(p)) ?? record.id) === record.id,
        )
      )
        return { plugin: record.id, viewType: editor.viewType, title: name };
  }
  return null;
}

/** The keys of a Markdown document's front matter, none without one. */
export function frontMatterKeys(content: string): string[] {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(
    content,
  );
  if (!m) return [];
  return [...m[1].matchAll(/^([\w-]+)\s*:/gm)].map((k) => k[1]);
}

/** The plugin that opens Markdown `path` in a tab of its own because of
 *  what its front matter says (a board's "kanban-plugin: board"). */
export function customEditorForContent(
  path: string,
  content: string,
): { plugin: string; viewType: string; title: string } | null {
  if (!pluginsSnapshot().allOn || !/\.(md|markdown)$/i.test(path)) return null;
  const keys = frontMatterKeys(content);
  if (!keys.length) return null;
  for (const record of pluginsSnapshot().records) {
    if (record.status !== "on" || !record.manifest) continue;
    for (const editor of record.manifest.contributes.customEditors)
      if (
        editor.priority === "default" &&
        editor.frontMatter.some(
          (key) =>
            keys.includes(key) &&
            (ownerOf(claimKey.editor(frontMatterClaim(key))) ?? record.id) ===
              record.id,
        )
      )
        return {
          plugin: record.id,
          viewType: editor.viewType,
          title: basename(path),
        };
  }
  return null;
}

/** The commands the plugins that are on put in the Plugins menu, in order. */
export function pluginMenuEntries(
  from: PluginsSnapshot = pluginsSnapshot(),
  menu: "app/plugins" | "app/tray" = "app/plugins",
  language: string = windowInfo().language(),
): { command: string; label: string; group: string }[] {
  if (!from.allOn) return [];
  return from.records.flatMap((record) => {
    const manifest = record.manifest;
    if (record.status !== "on" || !manifest) return [];
    // Each command under its plugin's name, for a submenu of its own.
    const group = localize(manifest, manifest.name, language);
    const commands = (manifest.contributes.menus[menu] ?? []).map((item) => {
      const command = manifest.contributes.commands.find(
        (c) => c.command === item.command,
      );
      return {
        command: item.command,
        label: localize(manifest, command?.title ?? item.command, language),
        group,
      };
    });
    // Its settings, last in its submenu; alone, named for it.
    const settled =
      menu === "app/plugins" &&
      (manifest.contributes.settings.length > 0 ||
        !!manifest.contributes.settingsPage);
    const t = currentStrings();
    return settled
      ? [
          ...commands,
          {
            command: PLUGIN_SETTINGS + record.id,
            label: commands.length
              ? t.menuPluginSettings
              : t.menuPluginSettingsOf.replace("{name}", group),
            group,
          },
        ]
      : commands;
  });
}
