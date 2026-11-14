import type { PluginFile } from "../../platform/ipc";
import { ownWhenKey } from "../contributions/plugin-when-keys";
import type { Permission, PluginManifest } from "./manifest";
import { PERMISSION_CALLS } from "../api-permissions";
import { grants } from "../grants";
import { WHEN_KEYS, whenKeys } from "../contributions/when";

/**
 * What a plugin's own code shows will go wrong once it runs, read before it
 * is installed: mistakes the app's AI makes when it writes one, which the
 * user would otherwise meet as a plugin that silently does nothing.
 */
export type PluginCheck =
  /** host.js reaches for the DOM, which is its hidden frame's, not the
   *  app's: nothing it draws there shows. */
  | { kind: "dom" }
  | { kind: "permission"; permission: Permission }
  /** A command, tab or view the manifest declares that the code never
   *  registers: its menu item or tab does nothing. */
  | { kind: "unregistered"; id: string }
  /** A menu item's `when` reads a key Textus doesn't set: it never shows. */
  | { kind: "when"; key: string };

/** Timers are the frame's own and fine; anything else on these is the
 *  frame's page. */
const DOM =
  /\b(document|localStorage|sessionStorage)\s*\.|\bwindow\s*\.(?!(set|clear)(Timeout|Interval)\b)/;

/** Comments left out, so a comment naming `document.body` is no finding. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function checkPlugin(
  manifest: PluginManifest,
  files: readonly PluginFile[],
): PluginCheck[] {
  const bare = (path: string) => path.replace(/^\.\//, "");
  const main = new Set((manifest.main ?? []).map(bare));
  const source = code(
    files
      .filter((f) => main.has(bare(f.path)))
      .map((f) => f.text)
      .join("\n"),
  );
  if (!source) return [];
  const checks: PluginCheck[] = [];
  if (DOM.test(source)) checks.push({ kind: "dom" });
  for (const [call, permission] of PERMISSION_CALLS)
    if (call.test(source) && !grants(manifest.permissions, permission))
      checks.push({ kind: "permission", permission });
  for (const key of unknownWhenKeys(manifest))
    checks.push({ kind: "when", key });
  const { commands, sidebarTabs, views } = manifest.contributes;
  const ids = [
    ...commands.map((c) => c.command),
    ...sidebarTabs.map((s) => s.id),
    ...views.map((v) => v.id),
  ];
  for (const id of ids)
    if (!registered(source, manifest.id, id))
      checks.push({ kind: "unregistered", id });
  return checks;
}

/** Whether `source` names `id` - whole, or as the plugin's id joined to its
 *  last part (`ctx.plugin.id + ".add"`). */
function registered(source: string, pluginId: string, id: string): boolean {
  if (source.includes(id)) return true;
  if (!id.startsWith(`${pluginId}.`)) return false;
  const rest = id.slice(pluginId.length);
  return ['"', "'", "`"].some((q) => source.includes(`${rest}${q}`));
}

/** The keys the manifest's menu `when` clauses read that Textus never sets. */
function unknownWhenKeys(manifest: PluginManifest): string[] {
  const keys = new Set<string>();
  for (const items of Object.values(manifest.contributes.menus ?? {}))
    for (const item of items ?? [])
      for (const key of whenKeys(item.when ?? ""))
        if (!WHEN_KEYS.includes(key) && !ownWhenKey(manifest.id, key))
          keys.add(key);
  return [...keys];
}
