import { useEffect, useRef } from "react";
import { drawPreview, type PreviewHandle } from "./preview-editor";
import { useLatest } from "../utils/hooks/useLatest";
import type { Settings } from "../prefs/SettingsContext";

/** Markdown drawn read-only by the editor itself (preview-editor): made
 *  once, only the blocks that change drawn again, let go as it leaves. */
export function EditorPreview({
  markdown,
  docPath,
  label,
  settings,
  page = false,
  className,
}: {
  markdown: string;
  /** Where its pictures and links are found from. */
  docPath: string | null;
  /** What a screen reader calls it. */
  label: string;
  /** The settings it draws by, live; else as stored. */
  settings?: { readonly current: Settings };
  /** A page of its own (the split view's), not part of one. */
  page?: boolean;
  className?: string;
}) {
  const markdownRef = useLatest(markdown);
  const labelRef = useLatest(label);
  const settingsRef = useLatest(settings);
  const root = useRef<HTMLDivElement>(null);
  const handle = useRef<PreviewHandle | null>(null);

  useEffect(() => {
    let live = true;
    let made: PreviewHandle | null = null;
    void drawPreview(
      root.current!,
      markdownRef.current,
      docPath,
      () => labelRef.current,
      settingsRef.current,
      page,
    ).then((preview) => {
      if (!live) return preview.destroy();
      made = preview;
      handle.current = preview;
      // What changed while it was made.
      preview.update(markdownRef.current);
    });
    return () => {
      live = false;
      handle.current = null;
      made?.destroy();
    };
  }, [docPath, labelRef, markdownRef, settingsRef, page]);

  useEffect(() => {
    handle.current?.update(markdown);
  }, [markdown]);

  return <div ref={root} className={className} />;
}
