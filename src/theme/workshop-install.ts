import { themes } from "../platform/ipc";
import type { UserThemeMeta } from "../prefs/SettingsContext";
import { BUILTIN_CONTENT_THEMES } from "../prefs/builtin-themes";
import { builtinThemeCss, type ThemeCss } from "./builtin-base";
import { saveUserTheme, withUserTheme } from "./theme-import";
import { NO_CHOICES, type FontStacks } from "./theme-typography";
import {
  readWorkshopTheme,
  workshopThemeCss,
  type ChromePins,
  type WorkshopTheme,
} from "./workshop-theme";

/** A theme's files: a built-in one restated, an installed one as stored.
 *  Null when an installed one can't be read. */
async function themeFiles(
  id: string,
  userThemes: readonly UserThemeMeta[],
): Promise<ThemeCss | null> {
  if (BUILTIN_CONTENT_THEMES.some((theme) => theme.id === id))
    return builtinThemeCss(id);
  const meta = userThemes.find((theme) => theme.id === id);
  if (!meta) return null;
  const light = await themes.loadThemeCss(id, "light");
  if (light === null) return null;
  const dark = meta.hasDark ? await themes.loadThemeCss(id, "dark") : null;
  return { light, dark };
}

/** Where the workshop starts from a theme: a workshop theme (made here or
 *  imported) as it was left, its starting theme and choices; any other
 *  as it is, every choice the theme's own. */
export async function startingTheme(
  id: string,
  userThemes: readonly UserThemeMeta[],
  name: string,
): Promise<WorkshopTheme | null> {
  const files = await themeFiles(id, userThemes);
  if (!files) return null;
  return (
    readWorkshopTheme(files, name) ?? {
      name,
      base: files,
      choices: NO_CHOICES,
    }
  );
}

/** Saves the workshop's theme - new, or over `replacing`, one the workshop
 *  made - and returns the settings that list it and put it in use. */
export async function installWorkshopTheme(
  theme: WorkshopTheme,
  stacks: FontStacks | undefined,
  chrome: ChromePins | undefined,
  userThemes: UserThemeMeta[],
  replacing?: string,
  faces?: string,
): Promise<{
  css: ThemeCss;
  settings: { userThemes: UserThemeMeta[]; themeId: string };
}> {
  const css = workshopThemeCss(theme, stacks, chrome, faces);
  const meta = await saveUserTheme(
    css.light,
    { name: theme.name, workshop: true },
    replacing,
    css.dark ?? undefined,
  );
  return {
    css,
    settings: { userThemes: withUserTheme(userThemes, meta), themeId: meta.id },
  };
}
