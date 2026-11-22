import type { FileIconThemeContribution } from "./manifest-types";
import { ManifestError, list, object, text, type Json } from "./manifest-json";

const THEME_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** `contributes.fileIconThemes`: icon themes for the files and folders
 *  listed, each a JSON file of the plugin's (file-icon-theme-json.ts). */
export function parseFileIconThemes(c: Json): FileIconThemeContribution[] {
  const seen = new Set<string>();
  return list(c.fileIconThemes, "contributes.fileIconThemes").map((x, i) => {
    const at = `contributes.fileIconThemes[${i}]`;
    const o = object(x, at);
    const id = text(o.id, `${at}.id`);
    if (!THEME_ID.test(id))
      throw new ManifestError(
        `${at}.id must be lowercase letters, digits and dashes.`,
      );
    if (seen.has(id)) throw new ManifestError(`${at}.id "${id}" is taken.`);
    seen.add(id);
    const path = text(o.path, `${at}.path`).replace(/^\.\//, "");
    if (
      !/\.json$/i.test(path) ||
      path.startsWith("/") ||
      path.split(/[\\/]/).some((p) => p === ".." || p === "")
    )
      throw new ManifestError(`${at}.path must be a .json file in the plugin.`);
    return { id, label: text(o.label, `${at}.label`), path };
  });
}
