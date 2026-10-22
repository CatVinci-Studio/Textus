import { errorText } from "../../utils/error-text";
import { useId, useRef, useState } from "react";
import { useSettings, THEME_MODES } from "../SettingsContext";
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

const CUSTOM_CSS_PLACEHOLDER = `#write > p {
  text-indent: 2em;
  line-height: 2;
}`;

/** The variables a theme sets (see the textus-theme skill), as the current
 *  theme resolves them - the starting point of an exported theme. */
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
  // A proposed revision's colours (design-system.css).
  "--revision-insert-bg",
  "--revision-insert-text",
  "--revision-insert-hover-bg",
  "--revision-reading-bg",
  "--revision-delete-bg",
  "--revision-delete-text",
  "--revision-delete-strike",
  "--revision-delete-hover-bg",
];

/**
 * Writes the current theme out as a starter CSS file (#13): the colour and
 * font variables as they resolve right now, Textus's heading/quote/table
 * ornaments (#29), the user's own CSS, and a few commented hooks for the
 * usual adjustments. Importing the edited file
 * (Import CSS…) makes it a theme of its own.
 */
async function exportThemeCss(t: Strings, customCss: string): Promise<void> {
  const style = getComputedStyle(document.documentElement);
  const write = document.querySelector("#write");
  const writeStyle = write ? getComputedStyle(write) : null;
  // The Default theme leaves --editor-bg and --editor-font unset and falls
  // back to the app's --bg and --font-sans; written out commented, the
  // file pinned the text colour but not the page under it, and read dark
  // on dark once imported. Their fallbacks are written instead.
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
  // An imported theme sets its own type (content-base.css), so the face,
  // size and leading the document has now go into the file as well.
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
  const css = `/* Textus theme - exported from Settings > More themes.
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
    await showMessage(`${t.exportFailed} ${errorText(err)}`, { tone: "error" });
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
      setError(errorText(err));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run };
}

/** Settings › Editor & Appearance › Theme: which form (light, dark) and
 *  which theme - a choice and nothing else. Getting themes and changing
 *  them is on the More themes page `onMore` opens (MoreThemesSection). */
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
        label={t.themeMoreLabel}
        onOpen={onMore}
        className="theme-more-entry"
      />
    </>
  );
}

/**
 * Settings › Editor & Appearance › More themes: where themes come from -
 * the gallery (`onBrowse` opens it, a page of its own) and a CSS file -
 * then the user's own CSS on top of whichever is picked. Each action is
 * here once; the theme picker itself stays on the page before.
 */
export function MoreThemesSection({
  t,
  onBrowse,
}: {
  t: Strings;
  onBrowse: () => void;
}) {
  const { settings, setSettings } = useSettings();
  const latest = useLatest(settings);
  const { busy, error, run } = useThemeAction();
  const customCssLabelId = useId();

  // One step: pick a CSS file and it's imported and selected right away,
  // named after the file. (A dark variant can still exist in the data model
  // for themes that shipped one; imports are single-file.)
  const importTheme = () =>
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

  return (
    <>
      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}
      <section className="settings-group">
        <div className="settings-group-body">
          <LinkRow label={t.themeGalleryBrowse} onOpen={onBrowse} />
          <SettingRow label={t.themeImportLabel}>
            <button
              className="text-button settings-inline-button"
              onClick={() => void importTheme()}
              disabled={busy}
            >
              {t.themeImportButton}
            </button>
          </SettingRow>
        </div>
      </section>

      {/* A tweak on top of the theme. On a page of its own, so shown open:
          nothing else here competes with it for room. */}
      <section className="settings-group">
        <div className="settings-group-body">
          <div className="settings-row settings-row-stacked">
            <div className="settings-row-label">
              <span id={customCssLabelId}>{t.customCssLabel}</span>
              <RowHelp label={t.customCssLabel}>{t.customCssHint}</RowHelp>
            </div>
            <textarea
              className="settings-code-input"
              aria-labelledby={customCssLabelId}
              spellCheck={false}
              rows={5}
              placeholder={CUSTOM_CSS_PLACEHOLDER}
              value={settings.customCss}
              onChange={(e) => setSettings({ customCss: e.target.value })}
            />
            <div className="shortcut-row-controls">
              <button
                className="text-button settings-inline-button"
                onClick={() => void exportThemeCss(t, settings.customCss)}
              >
                {t.themeExportButton}
              </button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
