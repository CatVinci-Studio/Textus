import { isIOSApp } from "../platform/capabilities";
import { plugins as pluginsIpc } from "../platform/ipc";
import { installFromCatalog, loadCatalog, catalogSnapshot } from "./catalog";
import { loadPlugins, uninstallPlugin } from "./manager";

/**
 * The official plugins as Textus 1.3.0-beta.1 had them (1.x, on the plugin
 * API before 1.0) moved to their 0.1.0 rewrites, once, when a window
 * starts: each replaced from the catalog as it was - on or off - its
 * permissions carried over to their new names; Split Panes, now part of
 * Textus, removed. Nothing happens when none is installed, so most
 * windows never ask the catalog.
 */

/** Permissions as the API before 1.0 named them. */
export const RENAMED_PERMISSIONS: Record<string, string> = {
  "document.read": "editor.read",
  "document.propose": "editor.propose",
  "workspace.read": "files.read",
  "workspace.write": "files.write",
};

/** Official plugins no longer offered: what they did is Textus's own. */
export const DELISTED = ["catvinci.split-panes"];

const major = (version: unknown) =>
  typeof version === "string" ? Number(version.split(".")[0]) : NaN;

/** The version an installed plugin's manifest (its text) says. */
function versionOf(manifest: string): unknown {
  try {
    return (JSON.parse(manifest) as { version?: unknown }).version;
  } catch {
    return undefined;
  }
}

/** Grants under their new names, each once. */
export function renamedGrants(granted: readonly string[]): string[] {
  return [...new Set(granted.map((p) => RENAMED_PERMISSIONS[p] ?? p))];
}

export async function migrateOfficialPlugins(): Promise<void> {
  if (isIOSApp) return;
  const [state, installed] = await Promise.all([
    pluginsIpc.state(),
    pluginsIpc.installed(),
  ]);
  const official = installed.filter(
    (p) => !p.dev && state.plugins[p.id]?.official,
  );
  const delisted = official.filter((p) => DELISTED.includes(p.id));
  const old = official.filter(
    (p) => !DELISTED.includes(p.id) && major(versionOf(p.manifest)) >= 1,
  );
  if (!delisted.length && !old.length) return;
  for (const p of delisted) await uninstallPlugin(p.id).catch(() => {});
  if (!old.length) return;
  await loadCatalog();
  const catalog = catalogSnapshot();
  if (catalog.status !== "ready") return;
  for (const p of old) {
    if (!catalog.items.some((i) => i.id === p.id && major(i.version) === 0))
      continue;
    const was = state.plugins[p.id];
    try {
      await installFromCatalog(p.id);
      await pluginsIpc.set(p.id, was.enabled, renamedGrants(was.granted));
    } catch {
      // Left as it was; Settings offers it again.
    }
  }
  await loadPlugins(true);
}
