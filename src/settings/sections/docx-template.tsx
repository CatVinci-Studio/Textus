import { fs } from "../../platform/ipc";
import { useSettings } from "../../prefs/SettingsContext";
import type { Strings } from "../../i18n/strings";
import { SettingRow } from "./controls";

/** The Word file a Word export takes its styles from (Pandoc's
 *  --reference-doc). Which one is a value, so it shows under the label. */
export function DocxTemplateRow({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const doc = settings.docxReferenceDoc;

  async function pick() {
    const picked = await fs.openImageFileDialog(t.menuExportDocx, ["docx"]);
    if (picked) setSettings({ docxReferenceDoc: picked });
  }

  return (
    <SettingRow
      label={t.docxTemplateLabel}
      help={t.docxTemplateHelp}
      hint={doc || t.docxTemplateNone}
    >
      <div className="settings-inline-buttons">
        {doc && (
          <button
            className="text-button settings-inline-button"
            onClick={() => setSettings({ docxReferenceDoc: "" })}
          >
            {t.docxTemplateClear}
          </button>
        )}
        <button className="text-button settings-inline-button" onClick={pick}>
          {t.agentWorkspaceRootPick}
        </button>
      </div>
    </SettingRow>
  );
}
