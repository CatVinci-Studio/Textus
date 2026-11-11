import { useEffect, useRef } from "react";
import { drawPreview, type PreviewHandle } from "../preview-editor";
import { useSettings } from "../../prefs/SettingsContext";
import { useLatest } from "../../utils/hooks/useLatest";

interface Props {
  markdown: string;
  filePath: string | null;
}

/** The editor itself, read-only, with every syntax drawn (preview-editor):
 *  the preview shows exactly what the editor reads. Only the blocks that
 *  changed are drawn again as the source changes. */
export function SplitPreview({ markdown, filePath }: Props) {
  const { settings, t } = useSettings();
  const settingsRef = useLatest(settings);
  const labelRef = useLatest(t.splitPreview);
  const markdownRef = useLatest(markdown);
  const root = useRef<HTMLDivElement>(null);
  const handle = useRef<PreviewHandle | null>(null);

  useEffect(() => {
    let live = true;
    let made: PreviewHandle | null = null;
    void drawPreview(
      root.current!,
      markdownRef.current,
      filePath,
      () => labelRef.current,
      settingsRef,
    ).then((preview) => {
      if (!live) return preview.destroy();
      made = preview;
      handle.current = preview;
      // What was typed while it was made.
      preview.update(markdownRef.current);
    });
    return () => {
      live = false;
      handle.current = null;
      made?.destroy();
    };
  }, [filePath, labelRef, markdownRef, settingsRef]);

  useEffect(() => {
    handle.current?.update(markdown);
  }, [markdown]);

  return <div ref={root} className="split-preview-editor milkdown" />;
}
