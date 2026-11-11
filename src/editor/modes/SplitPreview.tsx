import { EditorPreview } from "../EditorPreview";
import { useSettings } from "../../prefs/SettingsContext";
import { useLatest } from "../../utils/hooks/useLatest";

/** The editor itself, read-only, with every syntax drawn: the preview
 *  shows exactly what the editor reads, by the live settings. */
export function SplitPreview({
  markdown,
  filePath,
}: {
  markdown: string;
  filePath: string | null;
}) {
  const { settings, t } = useSettings();
  const settingsRef = useLatest(settings);
  return (
    <EditorPreview
      markdown={markdown}
      docPath={filePath}
      label={t.splitPreview}
      settings={settingsRef}
      page
      className="split-preview-editor milkdown"
    />
  );
}
