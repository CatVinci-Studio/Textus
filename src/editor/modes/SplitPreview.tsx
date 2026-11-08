import { useEffect } from "react";
import { Editor, editorViewCtx } from "@milkdown/kit/core";
import { listenerCtx } from "@milkdown/kit/plugin/listener";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { configureEditorRoot, withEditorCore } from "../editor-extensions";
import { useEditorRunner } from "../useEditorRunner";
import { parseMarkdownSource } from "../markdown/parse-markdown-source";
import { pastReadOnly, setReadOnly } from "../read-only-plugin";
import { useSettings } from "../../prefs/SettingsContext";
import { useLatest } from "../../utils/hooks/useLatest";

/** More for the preview to draw, from the layer above (plugins' blocks). */
export type PreviewExtras = (
  editor: Editor,
  docPath: { readonly current: string | null },
) => Editor;

interface Props {
  markdown: string;
  filePath: string | null;
  extras?: PreviewExtras;
}

/** The editor itself, read-only, with every syntax drawn: the preview shows
 *  exactly what the editor reads, from the same parser and plugins. */
function PreviewEditor({ markdown, filePath, extras }: Props) {
  const { settings, t } = useSettings();
  const settingsRef = useLatest(settings);
  const docPathRef = useLatest(filePath);
  const labelRef = useLatest(t.splitPreview);

  useEditor((root) => {
    const editor = withEditorCore(
      Editor.make().config((ctx) => {
        configureEditorRoot(ctx, root, markdown, () => labelRef.current);
        ctx
          .get(listenerCtx)
          .mounted((ctx) => setReadOnly(ctx.get(editorViewCtx), true));
      }),
      {
        settings: settingsRef,
        docPath: docPathRef,
        // Read-only: nothing is ever pasted here.
        onImagePasteError: () => "",
        requestImageName: async () => null,
        preview: true,
      },
    );
    // What plugins draw (a chart, a mind map, a database) is drawn here too,
    // as in the rendered view.
    return extras ? extras(editor, docPathRef) : editor;
  }, []);

  // Only the blocks that changed are replaced, so the rest keep their drawing.
  const run = useEditorRunner();
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const next = parseMarkdownSource(ctx, markdown);
      const old = view.state.doc;
      if (!next) return;
      const start = old.content.findDiffStart(next.content);
      if (start === null) return;
      let { a, b } = old.content.findDiffEnd(next.content)!;
      const overlap = start - Math.min(a, b);
      if (overlap > 0) {
        a += overlap;
        b += overlap;
      }
      view.dispatch(
        pastReadOnly(
          view.state.tr
            .replace(start, a, next.slice(start, b))
            .setMeta("addToHistory", false),
        ),
      );
    });
  }, [markdown, run]);

  return <Milkdown />;
}

export function SplitPreview(props: Props) {
  return (
    <MilkdownProvider>
      <PreviewEditor {...props} />
    </MilkdownProvider>
  );
}
