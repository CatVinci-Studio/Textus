import { useState } from "react";
import type { Strings } from "../../i18n/strings";
import { fs } from "../../platform/ipc";
import { useSettings } from "../../prefs/SettingsContext";
import { settingsFileText, settingsFromFile } from "../../prefs/settings-file";
import { showConfirm } from "../../ui/app-dialog";
import { explainError } from "../../utils/error-explain";
import { SettingRow } from "./controls";

/** Settings › General's export and import of the settings as a file. */
export function SettingsFileSection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const [error, setError] = useState<string | null>(null);

  async function exportFile() {
    setError(null);
    const path = await fs.saveSettingsFileDialog("Textus Settings.json");
    if (!path) return;
    try {
      await fs.writeTextFile(path, settingsFileText(settings));
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
      if (ok) setSettings(imported);
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
