import { plugins as pluginsIpc } from "../platform/ipc";
import { getWindowAccess } from "./app-bridge";
import { localize } from "./manifest";
import { pluginsSnapshot, windowInfo } from "./plugin-records";

/**
 * A plugin's usage guide: the USAGE.md in its package - USAGE.<lang>.md in
 * the UI's language where it has one - opened in a tab as a clean draft,
 * as the Help menu's guides are, once the plugin is installed and from its
 * page in Settings.
 */

/** The guide's text, or null when the plugin has none. */
export async function usageGuide(
  id: string,
  language: string = windowInfo().language(),
): Promise<string | null> {
  for (const name of [`USAGE.${language}.md`, "USAGE.md"]) {
    try {
      return new TextDecoder().decode(await pluginsIpc.file(id, name));
    } catch {
      // Not in this language: the next.
    }
  }
  return null;
}

/** Opens plugin `id`'s guide in a tab; false when it has none. */
export async function openUsageGuide(id: string): Promise<boolean> {
  const text = await usageGuide(id);
  const access = getWindowAccess();
  if (text === null || !access) return false;
  // The tab is named after the plugin, in the UI's language.
  const manifest = pluginsSnapshot().records.find((r) => r.id === id)?.manifest;
  const name = manifest
    ? localize(manifest, manifest.name, windowInfo().language())
    : id;
  access.openGuide(text, name);
  return true;
}
