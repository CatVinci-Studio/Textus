import { fs } from "../../platform/ipc";
import { useSettings } from "../../prefs/SettingsContext";
import type { Settings } from "../../prefs/settings-types";
import type { Strings } from "../../i18n/strings";
import { SettingRow } from "./controls";

type FileSetting = "docxReferenceDoc" | "exportBibliography" | "exportCsl";

/** A file an export reads, by its setting: which kinds it takes, and the
 *  row's words. */
const FILES: Record<
  FileSetting,
  {
    extensions: string[];
    label: (t: Strings) => string;
    help: (t: Strings) => string;
    none: (t: Strings) => string;
    clear: (t: Strings) => string;
  }
> = {
  docxReferenceDoc: {
    extensions: ["docx"],
    label: (t) => t.docxTemplateLabel,
    help: (t) => t.docxTemplateHelp,
    none: (t) => t.docxTemplateNone,
    clear: (t) => t.docxTemplateClear,
  },
  exportBibliography: {
    extensions: ["bib", "json", "yaml"],
    label: (t) => t.exportBibliographyLabel,
    help: (t) => t.exportBibliographyHelp,
    none: (t) => t.exportBibliographyNone,
    clear: (t) => t.exportBibliographyClear,
  },
  exportCsl: {
    extensions: ["csl"],
    label: (t) => t.exportCslLabel,
    help: (t) => t.exportCslHelp,
    none: (t) => t.docxTemplateNone,
    clear: (t) => t.docxTemplateClear,
  },
};

/** A file an export takes (the Word template: Pandoc's --reference-doc; a
 *  bibliography and its style). Which one is a value, so it shows under the
 *  label. */
export function ExportFileRow({
  t,
  setting,
}: {
  t: Strings;
  setting: FileSetting;
}) {
  const { settings, setSettings } = useSettings();
  const file = FILES[setting];
  const chosen = settings[setting];
  const set = (value: string) =>
    setSettings({ [setting]: value } as Partial<Settings>);

  async function pick() {
    const picked = await fs.openImageFileDialog(file.label(t), file.extensions);
    if (picked) set(picked);
  }

  return (
    <SettingRow
      label={file.label(t)}
      help={file.help(t)}
      hint={chosen || file.none(t)}
    >
      <div className="settings-inline-buttons">
        {chosen && (
          <button
            className="text-button settings-inline-button"
            onClick={() => set("")}
          >
            {file.clear(t)}
          </button>
        )}
        <button className="text-button settings-inline-button" onClick={pick}>
          {t.agentWorkspaceRootPick}
        </button>
      </div>
    </SettingRow>
  );
}
