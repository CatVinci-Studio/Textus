import { themeGallery } from "../platform/ipc";
import type { UserThemeMeta } from "../settings/SettingsContext";
import { saveUserTheme } from "./theme-import";

/// The public theme gallery (github.com/CatVinci-Studio/textus-themes):
/// what Settings › Browse themes lists, and installing one of its themes as
/// a user theme - the same kind Import CSS… makes, remembering which gallery
/// theme it came from so a newer version shows as an update.

/** One theme of the gallery's catalog. Mirrors `GalleryTheme` in
 *  src-tauri/src/commands/theme_gallery.rs - change both. */
export interface GalleryTheme {
  id: string;
  name: string;
  author: string;
  description: string;
  license: string;
  source: string;
  created: string;
  updated: string;
  /** Path in the gallery repository, e.g. `themes/plain/theme.css`. */
  css: string;
  previews: string[];
}

export type GalleryStatus = "install" | "installed" | "update";

/** The user theme installed from this gallery theme, if there is one. */
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
  const css = await themeGallery.css(theme.css);
  return saveUserTheme(
    css,
    {
      name: theme.name,
      gallery: { id: theme.id, updated: theme.updated, source: theme.source },
    },
    installed?.id,
  );
}
