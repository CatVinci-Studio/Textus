import { showConfirm } from "../../engine/controls/app-dialog";
import { Byline } from "../pages/CatalogRow";
import { Segmented } from "../../engine/controls/Segmented";
import { fill } from "../../i18n/fill";
import { requestWorkshop } from "../../ai/chat/create-request";
import { useRef, useState } from "react";
import { isEffectiveDark } from "../../theme/imported-theme";
import { useSettings, THEME_MODES } from "../../prefs/SettingsContext";
import { BUILTIN_CONTENT_THEMES } from "../../prefs/builtin-themes";
import type { Strings } from "../../i18n/strings";
import { withUserTheme } from "../../theme/theme-import";
import { exportUserTheme, importThemeFile } from "./theme-files";
import { ThemeCardMore } from "./ThemeCardMore";
import { ornamentRules } from "../../theme/theme-export";
import { showMessage } from "../../engine/controls/app-dialog";
import { exportDoc, fs, themes } from "../../platform/ipc";
import { useLatest } from "../../utils/hooks/useLatest";
import { Select } from "../../engine/controls/Select";
import { SettingRow } from "./controls";
import { useCustomCssDialog } from "./custom-css-dialog";
import {
  AvailableThemes,
  galleryCopies,
  galleryUpdates,
  ThemeByline,
  ThemeCard,
  useGalleryCatalog,
  useGalleryInstall,
} from "./theme-gallery";
import { ThemeGalleryPage } from "./theme-gallery-page";
import { ExtensionsTabLayout } from "../pages/ExtensionsTabLayout";
import { currentStrings } from "../../i18n/current";
import { explainError } from "../../utils/error-explain";
import { matchesWords } from "../../utils/match-words";
import { madeByAi } from "../../ai/chat/creations";

/** The variables a theme sets, as the current theme resolves them: the
 *  starting point of an exported theme. */
const THEME_VARIABLES = [
  "--doc-bg",
  "--doc-text",
  "--doc-muted",
  "--doc-accent",
  "--doc-border",
  "--doc-code-bg",
  "--doc-quote-border",
  "--doc-highlight-bg",
  "--doc-font",
  "--doc-list-gap",
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
  // The Default theme leaves --doc-bg and --doc-font unset, so their
  // fallbacks are written; otherwise an import read dark on dark.
  const fallbacks: Record<string, string> = {
    "--doc-bg": "--ui-bg",
    "--doc-font": "--font-sans",
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
    "  font-family: var(--doc-font);",
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
    void exportDoc.revealInDir(picked).catch(() => undefined);
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

/** Settings › Appearance: which form (light, dark) and which theme; a
 *  theme is added from CSS in the theme store's "⋯". */
export function ThemeSection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();

  return (
    <>
      {/* Independent of the theme below: that picks the palette, this picks
          which of its two forms is shown. Every theme defines both. */}
      <SettingRow label={t.appearanceModeLabel}>
        <Segmented
          kind="choice"
          label={t.appearanceModeLabel}
          value={settings.theme}
          onChange={(theme) => setSettings({ theme })}
          options={THEME_MODES.map((mode) => ({
            id: mode,
            label:
              mode === "system"
                ? t.appearanceSystem
                : mode === "light"
                  ? t.appearanceLight
                  : t.appearanceDark,
          }))}
        />
      </SettingRow>

      <SettingRow label={t.contentThemeLabel}>
        <Select
          className="settings-select"
          aria-label={t.contentThemeLabel}
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
      </SettingRow>
    </>
  );
}

/** A theme action's state, and importing one: picks a CSS file, imports it
 *  as a theme named after the file and selects it. */
function useImportTheme() {
  const action = useThemeAction();
  const { settings, setSettings } = useSettings();
  const latest = useLatest(settings);
  const importTheme = () =>
    action.run(async () => {
      const picked = await fs.openCssFileDialog();
      if (!picked) return;
      const meta = await importThemeFile(picked);
      setSettings({
        userThemes: withUserTheme(latest.current.userThemes, meta),
        themeId: meta.id,
      });
    });
  return { ...action, importTheme };
}

/** Settings › Extensions › Themes: the user's themes, Get more, and "⋯"
 *  to import, export or write one's own CSS. */
export function ThemesTab({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const latest = useLatest(settings);
  const { busy, error, run, importTheme } = useImportTheme();
  const [query, setQuery] = useState("");
  const [openTheme, setOpenTheme] = useState<string | null>(null);
  const customCss = useCustomCssDialog(t);
  const gallery = useGalleryCatalog();
  const install = useGalleryInstall(t);
  const updates = galleryUpdates(gallery.catalog, settings.userThemes);
  const copies = galleryCopies(gallery.catalog, settings.userThemes);
  const mine = settings.userThemes.filter((theme) =>
    matchesWords(theme.name, query),
  );
  // Asked first, as a plugin's or a skill's removal is.
  const remove = (id: string, name: string) =>
    run(async () => {
      const ok = await showConfirm(fill(t.themeDeleteAsk, { name }), {
        okLabel: t.themeDeleteButton,
        cancelLabel: t.cancel,
        danger: true,
      });
      if (!ok) return;
      await themes.deleteTheme(id);
      setSettings({
        userThemes: latest.current.userThemes.filter((th) => th.id !== id),
        ...(latest.current.themeId === id ? { themeId: "default" } : {}),
      });
    });
  const opened = gallery.catalog?.find((theme) => theme.id === openTheme);
  if (opened)
    return (
      <ThemeGalleryPage
        t={t}
        theme={opened}
        install={install}
        onBack={() => setOpenTheme(null)}
      />
    );
  return (
    <>
      {customCss.dialog}
      <ExtensionsTabLayout
        t={t}
        intro={t.extensionsIntroThemes}
        primary={{
          label: t.createMakeTheme,
          onSelect: () => requestWorkshop(),
        }}
        query={query}
        onQuery={setQuery}
        actions={[
          { label: t.themeImportButton, onSelect: () => void importTheme() },
          {
            label: t.themeExportButton,
            onSelect: () => void exportThemeCss(t, settings.customCss),
          },
          { label: t.customCssMenu, onSelect: customCss.open },
        ]}
        error={error}
        installedTitle={t.extensionsThemesInstalled}
        installedCount={settings.userThemes.length}
        installedCards={mine.length > 0}
        installed={
          mine.length ? (
            mine.map((theme) => {
              const copy = copies.get(theme.id);
              return (
                <ThemeCard
                  key={theme.id}
                  t={t}
                  data-user-theme={theme.id}
                  data-in-use={settings.themeId === theme.id || undefined}
                  name={theme.name}
                  description={copy?.description}
                  previews={copy?.previews}
                  sampleOf={{
                    id: theme.id,
                    hasDark: theme.hasDark,
                    dark: isEffectiveDark(settings.theme),
                  }}
                  byline={
                    copy ? (
                      <ThemeByline t={t} theme={copy} />
                    ) : (
                      madeByAi(settings.creations, "theme", theme.id) && (
                        <Byline t={t} madeHere />
                      )
                    )
                  }
                  onOpen={copy ? () => setOpenTheme(copy.id) : undefined}
                >
                  {updates.has(theme.id) && (
                    <button
                      type="button"
                      className="tx-button text-button settings-inline-button"
                      disabled={install.busy === theme.id}
                      onClick={() =>
                        void install.install(updates.get(theme.id)!)
                      }
                    >
                      {t.themeGalleryUpdate}
                    </button>
                  )}
                  {settings.themeId !== theme.id && (
                    <button
                      type="button"
                      className="tx-button text-button settings-inline-button"
                      disabled={busy}
                      onClick={() => setSettings({ themeId: theme.id })}
                    >
                      {t.themeGalleryUse}
                    </button>
                  )}
                  <button
                    type="button"
                    className="tx-button text-button settings-inline-button"
                    disabled={busy}
                    onClick={() => requestWorkshop(theme.id)}
                  >
                    {t.themeEditInWorkshop}
                  </button>
                  <ThemeCardMore
                    t={t}
                    name={theme.name}
                    onExport={() => void run(() => exportUserTheme(theme))}
                    onDelete={() => void remove(theme.id, theme.name)}
                  />
                </ThemeCard>
              );
            })
          ) : (
            <p className="tx-list-note">
              {query.trim()
                ? fill(t.pluginsSearchNone, { query: query.trim() })
                : t.extensionsThemesNone}
            </p>
          )
        }
        available={
          <AvailableThemes
            t={t}
            query={query}
            gallery={gallery}
            install={install}
            onOpen={(theme) => setOpenTheme(theme.id)}
          />
        }
      />
    </>
  );
}
