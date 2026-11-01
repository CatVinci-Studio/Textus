import { useState } from "react";
import type { Strings } from "../../i18n/strings";
import { fs, themes } from "../../platform/ipc";
import { useSettings } from "../../prefs/SettingsContext";
import {
  settingsFileText,
  settingsFromFile,
  type ThemeCss,
} from "../../prefs/settings-file";
import type { UserThemeMeta } from "../../prefs/settings-types";
import { showConfirm } from "../../ui/app-dialog";
import { explainError } from "../../utils/error-explain";
import { SettingRow } from "./controls";

/** The CSS of the imported themes, to travel with the settings. */
async function themeCss(list: UserThemeMeta[]): Promise<ThemeCss> {
  const found: ThemeCss = {};
  for (const theme of list) {
    const light = await themes.loadThemeCss(theme.id, "light");
    if (light === null) continue;
    const dark = theme.hasDark
      ? await themes.loadThemeCss(theme.id, "dark")
      : null;
    found[theme.id] = dark === null ? { light } : { light, dark };
  }
  return found;
}

/** Settings › General's export and import of the settings as a file. */
export function SettingsFileSection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const [error, setError] = useState<string | null>(null);

  async function exportFile() {
    setError(null);
    const path = await fs.saveSettingsFileDialog("Textus Settings.json");
    if (!path) return;
    try {
      const text = settingsFileText(
        settings,
        await themeCss(settings.userThemes),
      );
      await fs.writeTextFile(path, text);
    } catch (err) {
      setError(explainError(err, t));
    }
  }

  async function importFile() {
    setError(null);
    const path = await fs.openSettingsFileDialog();
    if (!path) return;
    try {
      const imported = settingsFromFile(await fs.readTextFile(path), settings);
      if (!imported) {
        setError(t.settingsFileNotSettings);
        return;
      }
      const ok = await showConfirm(t.settingsFileImportConfirm, {
        okLabel: t.settingsFileImportReplace,
        cancelLabel: t.cancel,
      });
      if (!ok) return;
      for (const [id, css] of Object.entries(imported.themes)) {
        await themes.saveThemeCss(id, "light", css.light);
        if (css.dark !== undefined)
          await themes.saveThemeCss(id, "dark", css.dark);
      }
      setSettings(imported.settings);
    } catch (err) {
      setError(explainError(err, t));
    }
  }

  return (
    <SettingRow
      label={t.settingsFileLabel}
      hint={t.settingsFileHint}
      error={error}
    >
      <button
        className="text-button settings-inline-button"
        onClick={() => void exportFile()}
      >
        {t.settingsFileExport}
      </button>
      <button
        className="text-button settings-inline-button"
        onClick={() => void importFile()}
      >
        {t.settingsFileImport}
      </button>
    </SettingRow>
  );
}
