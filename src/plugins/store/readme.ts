import { plugins as pluginsIpc } from "../../platform/ipc";
import { getWindowAccess } from "../app-bridge";
import { localize } from "./manifest";
import { pluginsSnapshot, windowInfo } from "./plugin-records";

/**
 * A plugin's README: what Get more shows on its page, and its guide once
 * installed. README.<lang>.md in the UI language where it has one (its base
 * language next, "zh" for "zh-Hant"), else README.md. Plugins made before
 * READMEs had USAGE.md instead.
 */

/** The file names to try for `language`, in order. */
export function readmeNames(language: string): string[] {
  const base = language.split("-")[0];
  const langs = [...new Set([language, base])];
  return [
    ...langs.map((l) => `README.${l}.md`),
    "README.md",
    ...langs.map((l) => `USAGE.${l}.md`),
    "USAGE.md",
  ];
}

/** An installed plugin's README, or null when it has none. */
export async function installedReadme(
  id: string,
  language: string = windowInfo().language(),
): Promise<string | null> {
  for (const name of readmeNames(language)) {
    try {
      return new TextDecoder().decode(await pluginsIpc.file(id, name));
    } catch {
      // Not this one: the next.
    }
  }
  return null;
}

/** A catalog plugin's README, from the catalog; null when it has none or
 *  it can't be fetched. */
export function catalogReadme(
  id: string,
  language: string = windowInfo().language(),
): Promise<string | null> {
  return pluginsIpc.catalogReadme(id, language).catch(() => null);
}

/** Opens installed plugin `id`'s README in a tab; false when it has none. */
export async function openReadme(id: string): Promise<boolean> {
  const text = await installedReadme(id);
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
