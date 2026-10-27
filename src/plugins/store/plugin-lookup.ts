import { basename } from "../../utils/path";
import { localize, matchesFilename } from "./manifest";
import {
  pluginsSnapshot,
  windowInfo,
  type PluginsSnapshot,
} from "./plugin-records";

/**
 * What the plugins on offer contribute, read from their manifests without
 * running them: a file's custom editor, the Plugins and tray menus' commands.
 */

/** The plugin that opens `path` in a tab of its own, if one is on:
 *  the first whose custom editor matches with priority "default". */
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
        editor.filenamePatterns.some((p) => matchesFilename(p, name))
      )
        return { plugin: record.id, viewType: editor.viewType, title: name };
  }
  return null;
}

/** The commands the plugins that are on put in the Plugins menu, in order. */
export function pluginMenuEntries(
  from: PluginsSnapshot = pluginsSnapshot(),
  menu: "app/plugins" | "app/tray" = "app/plugins",
  language: string = windowInfo().language(),
): { command: string; label: string }[] {
  if (!from.allOn) return [];
  return from.records.flatMap((record) => {
    const manifest = record.manifest;
    if (record.status !== "on" || !manifest) return [];
    return (manifest.contributes.menus[menu] ?? []).map((item) => {
      const command = manifest.contributes.commands.find(
        (c) => c.command === item.command,
      );
      return {
        command: item.command,
        label: localize(manifest, command?.title ?? item.command, language),
      };
    });
  });
}
