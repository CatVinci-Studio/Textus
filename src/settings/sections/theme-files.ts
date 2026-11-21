import { exportDoc, fs, themes } from "../../platform/ipc";
import type { UserThemeMeta } from "../../prefs/SettingsContext";
import { basename } from "../../utils/path";
import { importThemeCss, saveUserTheme } from "../../theme/theme-import";

/** A theme's dark file beside its light one, as the theme gallery names
 *  them: `name.css` and `name-dark.css`. */
export function darkSibling(path: string): string | null {
  if (/-dark\.css$/i.test(path)) return null;
  return path.replace(/\.css$/i, "") + "-dark.css";
}

/** Writes an installed theme's own files where the user picks, the dark one
 *  beside the light: what Import CSS… reads back as the same theme. */
export async function exportUserTheme(theme: UserThemeMeta): Promise<void> {
  const light = await themes.loadThemeCss(theme.id, "light");
  if (light === null) throw new Error(`${theme.name}: no stylesheet`);
  const dark = theme.hasDark
    ? await themes.loadThemeCss(theme.id, "dark")
    : null;
  const picked = await exportDoc.exportSaveDialog(
    `${theme.name.replace(/[\\/:*?"<>|]/g, "-")}.css`,
    "CSS",
    "css",
  );
  if (!picked) return;
  await fs.writeTextFile(picked, light);
  const beside = darkSibling(picked);
  if (dark && beside) await fs.writeTextFile(beside, dark);
  void exportDoc.revealInDir(picked).catch(() => undefined);
}

/** Imports a picked CSS file as a theme named after it, with the dark file
 *  beside it when there is one. */
export async function importThemeFile(path: string): Promise<UserThemeMeta> {
  const light = await importThemeCss(path);
  const beside = darkSibling(path);
  const dark = beside ? await importThemeCss(beside).catch(() => null) : null;
  return saveUserTheme(
    light,
    { name: basename(path).replace(/\.css$/i, "") },
    undefined,
    dark ?? undefined,
  );
}
