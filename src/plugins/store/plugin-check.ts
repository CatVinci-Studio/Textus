import type { PluginFile } from "../../platform/ipc";
import type { Permission, PluginManifest } from "./manifest";

/**
 * What a plugin's own code shows will go wrong once it runs, read before it
 * is installed: mistakes the app's AI makes when it writes one, which the
 * user would otherwise meet as a plugin that silently does nothing.
 */
export type PluginCheck =
  /** host.js reaches for the DOM, which is its hidden frame's, not the
   *  app's: nothing it draws there shows. */
  | { kind: "dom" }
  /** It keeps data in the open folder, so it fails with no folder open. */
  | { kind: "projectStorage" }
  | { kind: "permission"; permission: Permission }
  /** A command, tab or view the manifest declares that the code never
   *  registers: its menu item or tab does nothing. */
  | { kind: "unregistered"; id: string };

/** The calls that need a permission, as the broker checks them. */
const NEEDS: readonly [RegExp, Permission][] = [
  [
    /\btextus\.editor\.(getText|getPath|getSelection|getBlocks|getOutline)\b/,
    "editor.read",
  ],
  [/\btextus\.editor\.(edit|insertText|replaceSelection)\b/, "editor.write"],
  [/\btextus\.editor\.propose\b/, "editor.propose"],
  // Writing goes through the folder's root, which reading grants.
  [
    /\btextus\.(files\.(root|list|find|readText|writeText|create|process|rename)\b|metadata\.)/,
    "files.read",
  ],
  [/\btextus\.files\.(writeText|create|process|rename)\b/, "files.write"],
  [/\bstorage\.project\b/, "project.data"],
  [/\btextus\.env\.(readClipboard|writeClipboard)\b/, "clipboard"],
  [/\btextus\.ai\.registerTool\b/, "ai.tools"],
];

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
  if (/\bstorage\.project\b/.test(source))
    checks.push({ kind: "projectStorage" });
  const granted = new Set<string>(manifest.permissions);
  for (const [call, permission] of NEEDS)
    if (call.test(source) && !granted.has(permission))
      checks.push({ kind: "permission", permission });
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
