import { themeGallery } from "../platform/ipc";
import type { GalleryTheme_Serialize as GalleryThemeAnswer } from "../platform/bindings/app";
import type { UserThemeMeta } from "../prefs/SettingsContext";
import { saveUserTheme } from "./theme-import";

/// The public theme gallery: what Settings lists, and installing a theme as a
/// user theme that remembers its source, so a newer version shows as an update.

/** One theme of the gallery's catalog. */
export type GalleryTheme = GalleryThemeAnswer;

export type GalleryStatus = "install" | "installed" | "update";

export function installedCopy(
  theme: GalleryTheme,
  userThemes: UserThemeMeta[],
): UserThemeMeta | undefined {
  return userThemes.find((th) => th.gallery?.id === theme.id);
}

/** Whether the catalog's `updated` is later than the installed copy's.
 *  Both are ISO timestamps; one that doesn't parse counts as newer when it
 *  differs, so a changed theme is never stuck without an update. */
export function isNewer(catalog: string, installed: string): boolean {
  const a = Date.parse(catalog);
  const b = Date.parse(installed);
  if (Number.isNaN(a) || Number.isNaN(b)) return catalog !== installed;
  return a > b;
}

export function galleryStatus(
  theme: GalleryTheme,
  installed: UserThemeMeta | undefined,
): GalleryStatus {
  if (!installed?.gallery) return "install";
  return isNewer(theme.updated, installed.gallery.updated)
    ? "update"
    : "installed";
}

/** Downloads a gallery theme and saves it as a user theme - over
 *  `installed` when it is an update, so its id (and selection) stays. */
export async function installGalleryTheme(
  theme: GalleryTheme,
  installed?: UserThemeMeta,
): Promise<UserThemeMeta> {
  const [css, darkCss] = await Promise.all([
    themeGallery.css(theme.css, {
      version: theme.updated,
      update: !!installed,
    }),
    theme.darkCss ? themeGallery.css(theme.darkCss) : undefined,
  ]);
  return saveUserTheme(
    css,
    {
      name: theme.name,
      gallery: { id: theme.id, updated: theme.updated, source: theme.source },
    },
    installed?.id,
    darkCss,
  );
}
