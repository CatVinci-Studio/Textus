import { useId, useRef, useState } from "react";
import { useSettings, THEME_MODES } from "../../prefs/SettingsContext";
import { BUILTIN_CONTENT_THEMES } from "../../theme/builtin-themes";
import type { Strings } from "../../i18n/strings";
import {
  importThemeCss,
  saveUserTheme,
  withUserTheme,
} from "../../theme/theme-import";
import { ornamentRules } from "../../theme/theme-export";
import { basename } from "../../utils/path";
import { showMessage } from "../../ui/app-dialog";
import { exportDoc, fs, themes } from "../../platform/ipc";
import { useLatest } from "../../utils/hooks/useLatest";
import { Select } from "../../ui/Select";
import { LinkRow, RowHelp, SettingRow } from "./controls";
import { ThemeGallerySection } from "./theme-gallery";
import { ExtensionsTabLayout } from "../pages/ExtensionsTabLayout";
import { currentStrings } from "../../i18n/current";
import { explainError } from "../../utils/error-explain";

const CUSTOM_CSS_PLACEHOLDER = `#write > p {
  text-indent: 2em;
  line-height: 2;
}`;

/** The variables a theme sets, as the current theme resolves them: the
 *  starting point of an exported theme. */
const THEME_VARIABLES = [
  "--editor-bg",
  "--editor-text",
  "--editor-muted",
  "--editor-accent",
  "--editor-border",
  "--editor-code-bg",
  "--editor-quote-border",
  "--editor-highlight-bg",
  "--editor-font",
  "--editor-list-gap",
  // A proposed revision's colours.
  "--revision-insert-bg",
  "--revision-insert-text",
  "--revision-insert-hover-bg",
  "--revision-reading-bg",
  "--revision-delete-bg",
  "--revision-delete-text",
  "--revision-delete-strike",
  "--revision-delete-hover-bg",
];

/** Writes the current theme out as a starter CSS file: its variables as
 *  they resolve now, the ornaments, the user's CSS and a few hooks. */
async function exportThemeCss(t: Strings, customCss: string): Promise<void> {
  const style = getComputedStyle(document.documentElement);
  const write = document.querySelector("#write");
  const writeStyle = write ? getComputedStyle(write) : null;
  // The Default theme leaves --editor-bg and --editor-font unset, so their
  // fallbacks are written; otherwise an import read dark on dark.
  const fallbacks: Record<string, string> = {
    "--editor-bg": "--bg",
    "--editor-font": "--font-sans",
  };
  const resolve = (name: string) =>
    style.getPropertyValue(name).trim() ||
    writeStyle?.getPropertyValue(name).trim() ||
    "";
  const variables = THEME_VARIABLES.map((name) => {
    const value =
      resolve(name) || (fallbacks[name] ? resolve(fallbacks[name]) : "");
    return value ? `  ${name}: ${value};` : `  /* ${name}: ; */`;
  }).join("\n");
  // An imported theme sets its own type, so the document's current face, size
  // and leading go into the file too.
  const milkdown = document.querySelector(".milkdown");
  const type = milkdown ? getComputedStyle(milkdown) : null;
  const fontSize = type ? parseFloat(type.fontSize) : NaN;
  const lineHeight = type ? parseFloat(type.lineHeight) : NaN;
  const typeRules = [
    "  font-family: var(--editor-font);",
    fontSize > 0 ? `  font-size: ${Math.round(fontSize * 10) / 10}px;` : "",
    fontSize > 0 && lineHeight > 0
      ? `  line-height: ${Math.round((lineHeight / fontSize) * 100) / 100};`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const css = `/* Textus theme - exported from Settings > Extensions > Themes.
   Edit it, then bring it back with Import CSS… there.
   #write is the document; .milkdown wraps it. */

:root {
${variables}
}

/* Body text */
#write {
${typeRules}
  /* max-width: 860px; */
}

#write p {
  /* text-indent: 2em; */
}

#write h1,
#write h2,
#write h3 {
  /* font-family: "Songti SC", serif; */
}

/* Textus's ornaments - delete any you don't want */
${ornamentRules()}
${customCss.trim() ? `\n/* Custom CSS */\n${customCss}\n` : ""}`;
  const picked = await exportDoc.exportSaveDialog(
    "textus-theme.css",
    "CSS",
    "css",
  );
  if (!picked) return;
  try {
    await fs.writeTextFile(picked, css);
    void exportDoc.revealInDir(picked);
  } catch (err) {
    await showMessage(
      `${t.exportFailed} ${explainError(err, currentStrings())}`,
      { tone: "error" },
    );
  }
}

/** Runs one theme-file action at a time, with its error shown above the
 *  rows; `busy` disables the controls while one is in flight. */
function useThemeAction() {
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(explainError(err, currentStrings()));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run };
}

/** Settings › Editor & Appearance › Theme: which form (light, dark) and
 *  which theme, nothing else. */
export function ThemeSection({
  t,
  onMore,
}: {
  t: Strings;
  onMore: () => void;
}) {
  const { settings, setSettings } = useSettings();
  const appearanceId = useId();
  const latest = useLatest(settings);
  const { busy, error, run } = useThemeAction();

  // Beside the picker, as it removes the theme picked there.
  const deleteCurrentTheme = () =>
    run(async () => {
      const current = latest.current.userThemes.find(
        (th) => th.id === latest.current.themeId,
      );
      if (!current) return;
      await themes.deleteTheme(current.id);
      setSettings({
        userThemes: latest.current.userThemes.filter(
          (th) => th.id !== current.id,
        ),
        ...(latest.current.themeId === current.id
          ? { themeId: "default" }
          : {}),
      });
    });

  const isUserThemeSelected = settings.userThemes.some(
    (th) => th.id === settings.themeId,
  );

  return (
    <>
      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}
      {/* Independent of the theme below: that picks the palette, this picks
          which of its two forms is shown. Every theme defines both. */}
      <SettingRow label={t.appearanceLabel}>
        <div
          className="appearance-options"
          role="radiogroup"
          aria-label={t.appearanceLabel}
        >
          {THEME_MODES.map((mode) => (
            <label
              key={mode}
              className={`appearance-option${settings.theme === mode ? " is-selected" : ""}`}
            >
              <input
                type="radio"
                name={appearanceId}
                value={mode}
                checked={settings.theme === mode}
                onChange={() => setSettings({ theme: mode })}
              />
              {mode === "system"
                ? t.appearanceSystem
                : mode === "light"
                  ? t.appearanceLight
                  : t.appearanceDark}
            </label>
          ))}
        </div>
      </SettingRow>

      <SettingRow label={t.contentThemeLabel}>
        <Select
          className="settings-select"
          aria-label={t.contentThemeLabel}
          disabled={busy}
          value={settings.themeId}
          onChange={(e) => setSettings({ themeId: e.target.value })}
        >
          {BUILTIN_CONTENT_THEMES.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {t[theme.nameKey]}
            </option>
          ))}
          {settings.userThemes.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.name}
            </option>
          ))}
        </Select>
        {isUserThemeSelected && (
          <button
            className="text-button settings-inline-button"
            disabled={busy}
            onClick={() => void deleteCurrentTheme()}
          >
            {t.themeDeleteButton}
          </button>
        )}
      </SettingRow>

      <LinkRow
        label={t.themeGetMore}
        onOpen={onMore}
        className="theme-more-entry"
      />
    </>
  );
}

/** The phone's Editor & Appearance › More themes, as it has no Extensions:
 *  a CSS file to add, the user's own CSS, and the gallery. */
export function ThemeLibrarySection({ t }: { t: Strings }) {
  return (
    <>
      <ThemeSourcesSection t={t} />
      <section className="settings-group">
        <h2 className="settings-group-title">{t.extensionsThemesGet}</h2>
        <ThemeGallerySection t={t} />
      </section>
    </>
  );
}

/** Picks a CSS file, imports it as a theme named after the file and
 *  selects it. */
function useImportTheme(run: (action: () => Promise<void>) => Promise<void>) {
  const { settings, setSettings } = useSettings();
  const latest = useLatest(settings);
  return () =>
    run(async () => {
      const picked = await fs.openCssFileDialog();
      if (!picked) return;
      const css = await importThemeCss(picked);
      const meta = await saveUserTheme(css, {
        name: basename(picked).replace(/\.css$/i, ""),
      });
      setSettings({
        userThemes: withUserTheme(latest.current.userThemes, meta),
        themeId: meta.id,
      });
    });
}

/** The user's own CSS, on top of whichever theme is picked. */
function CustomCssRow({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const labelId = useId();
  return (
    <div className="settings-row settings-row-stacked">
      <div className="settings-row-label">
        <span id={labelId}>{t.customCssLabel}</span>
        <RowHelp label={t.customCssLabel}>{t.customCssHint}</RowHelp>
      </div>
      <textarea
        className="settings-code-input"
        aria-labelledby={labelId}
        spellCheck={false}
        rows={5}
        placeholder={CUSTOM_CSS_PLACEHOLDER}
        value={settings.customCss}
        onChange={(e) => setSettings({ customCss: e.target.value })}
      />
    </div>
  );
}

/** Settings › Extensions › Themes: the user's themes, Get more, "⋯" to
 *  import or export, and the user's own CSS folded under Advanced. */
export function ThemesTab({
  t,
  onGetMore,
}: {
  t: Strings;
  onGetMore: () => void;
}) {
  const { settings, setSettings } = useSettings();
  const latest = useLatest(settings);
  const { busy, error, run } = useThemeAction();
  const importTheme = useImportTheme(run);
  const remove = (id: string) =>
    run(async () => {
      await themes.deleteTheme(id);
      setSettings({
        userThemes: latest.current.userThemes.filter((th) => th.id !== id),
        ...(latest.current.themeId === id ? { themeId: "default" } : {}),
      });
    });
  return (
    <ExtensionsTabLayout
      t={t}
      intro={t.extensionsIntroThemes}
      onGetMore={onGetMore}
      actions={[
        { label: t.themeImportButton, onSelect: () => void importTheme() },
        {
          label: t.themeExportButton,
          onSelect: () => void exportThemeCss(t, settings.customCss),
        },
      ]}
      error={error}
      installedTitle={t.extensionsThemesInstalled}
      installed={
        settings.userThemes.length ? (
          settings.userThemes.map((theme) => (
            <div
              key={theme.id}
              className="settings-row plugin-card"
              data-user-theme={theme.id}
            >
              <div className="plugin-card-open">
                <span className="settings-row-label plugin-card-name">
                  {theme.name}
                </span>
              </div>
              <div className="settings-row-control">
                {settings.themeId === theme.id ? (
                  <span className="settings-row-value">
                    {t.themeGalleryInUse}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-button settings-inline-button"
                    disabled={busy}
                    onClick={() => setSettings({ themeId: theme.id })}
                  >
                    {t.themeGalleryUse}
                  </button>
                )}
                <button
                  type="button"
                  className="text-button settings-inline-button"
                  disabled={busy}
                  onClick={() => void remove(theme.id)}
                >
                  {t.themeDeleteButton}
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="plugin-empty">
            {t.extensionsThemesNone.replace("{page}", t.navEditor)}
          </p>
        )
      }
      advanced={<CustomCssRow t={t} />}
    />
  );
}

/** Your themes: a CSS file to add and the user's own CSS - what the
 *  phone's More themes page shows above the gallery. */
function ThemeSourcesSection({ t }: { t: Strings }) {
  const { settings } = useSettings();
  const { busy, error, run } = useThemeAction();
  const importTheme = useImportTheme(run);

  return (
    <>
      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}
      <section className="settings-group">
        <h2 className="settings-group-title">{t.extensionsThemesInstalled}</h2>
        <div className="settings-group-body">
          <SettingRow label={t.themeImportLabel}>
            <button
              className="text-button settings-inline-button"
              onClick={() => void importTheme()}
              disabled={busy}
            >
              {t.themeImportButton}
            </button>
          </SettingRow>
          <CustomCssRow t={t} />
          <div className="shortcut-row-controls">
            <button
              className="text-button settings-inline-button"
              onClick={() => void exportThemeCss(t, settings.customCss)}
            >
              {t.themeExportButton}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
