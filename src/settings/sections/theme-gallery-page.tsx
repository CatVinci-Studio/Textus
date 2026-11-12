import type { Strings } from "../../i18n/strings";
import { useSettings } from "../../prefs/SettingsContext";
import { installedCopy, type GalleryTheme } from "../../theme/theme-gallery";
import {
  GalleryPreview,
  ThemeByline,
  type useGalleryInstall,
} from "./theme-gallery";

/** A gallery theme's page in Get more, like a catalog plugin's: its name,
 *  byline and whole description, Install (or Use once it is installed), and
 *  every screenshot, light then dark, at full width. */
export function ThemeGalleryPage({
  t,
  theme,
  install,
  onBack,
}: {
  t: Strings;
  theme: GalleryTheme;
  install: ReturnType<typeof useGalleryInstall>;
  onBack: () => void;
}) {
  const { settings, setSettings } = useSettings();
  const copy = installedCopy(theme, settings.userThemes);
  const action = !copy ? (
    <button
      type="button"
      className="text-button settings-inline-button"
      disabled={install.busy === theme.id}
      onClick={() => void install.install(theme)}
    >
      {t.themeGalleryInstall}
    </button>
  ) : settings.themeId === copy.id ? (
    <span className="settings-row-value">{t.themeGalleryInUse}</span>
  ) : (
    <button
      type="button"
      className="text-button settings-inline-button"
      onClick={() => setSettings({ themeId: copy.id })}
    >
      {t.themeGalleryUse}
    </button>
  );
  return (
    <div className="plugin-page market-plugin-page" data-theme-page={theme.id}>
      <button type="button" className="plugin-back" onClick={onBack}>
        ‹ {t.themeBackToList}
      </button>
      <div className="market-plugin-head">
        <div className="market-plugin-title">
          <h2 className="plugin-page-title">{theme.name}</h2>
          {theme.description && (
            <div className="settings-row-hint">{theme.description}</div>
          )}
          <ThemeByline t={t} theme={theme} />
        </div>
        {action}
      </div>
      {install.error && (
        <div className="settings-error" role="alert">
          {install.error}
        </div>
      )}
      <div className="theme-gallery-shots">
        {theme.previews.map((path, i) => (
          <GalleryPreview
            key={path}
            paths={theme.previews}
            at={i}
            large
            label={`${t.themePreviewEnlarge}: ${theme.name}`}
          />
        ))}
      </div>
    </div>
  );
}
