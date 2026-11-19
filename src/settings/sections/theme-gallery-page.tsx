import type { Strings } from "../../i18n/strings";
import { MarketPage } from "../pages/MarketPage";
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
      className="tx-button text-button settings-inline-button"
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
      className="tx-button text-button settings-inline-button"
      onClick={() => setSettings({ themeId: copy.id })}
    >
      {t.themeGalleryUse}
    </button>
  );
  return (
    <MarketPage
      data={{ "data-theme-page": theme.id }}
      backLabel={t.themeBackToList}
      onBack={onBack}
      name={theme.name}
      description={theme.description}
      byline={<ThemeByline t={t} theme={theme} />}
      action={action}
    >
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
    </MarketPage>
  );
}
