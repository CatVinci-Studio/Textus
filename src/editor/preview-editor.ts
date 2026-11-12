import { Editor, editorViewCtx } from "@milkdown/kit/core";
import { configureEditorRoot, withEditorCore } from "./editor-extensions";
import { parseMarkdownSource } from "./markdown/parse-markdown-source";
import { replaceChanged } from "./replace-changed";
import { pastReadOnly, setReadOnly } from "./read-only-plugin";
import { loadSettings } from "../prefs/settings-store";
import type { Settings } from "../prefs/SettingsContext";
import "./preview-editor.css";
import { previewExtras } from "./preview-extras";
import { normalizeMathDelimiters } from "../utils/markdown-math";


/**
 * Markdown drawn by the editor itself, read-only, every syntax drawn - an
 * embedded note or a card shows what the document shows, from the same
 * parser and plugins. `update` draws new text over it, only the blocks
 * that changed; `destroy` lets it go.
 */
export async function drawPreview(
  root: HTMLElement,
  markdown: string,
  docPath: string | null,
  /** What a screen reader calls it. */
  label: () => string,
  /** The settings it draws by, live; else as stored now. */
  settings: { readonly current: Settings } = { current: loadSettings() },
  /** A page of its own (the split view's), not part of one. */
  page = false,
): Promise<PreviewHandle> {
  const docPathRef = { current: docPath };
  root.classList.add("editor-preview");
  root.classList.toggle("editor-preview-inline", !page);
  const core = withEditorCore(
    Editor.make().config((ctx) =>
      configureEditorRoot(ctx, root, normalizeMathDelimiters(markdown), label),
    ),
    {
      settings,
      docPath: docPathRef,
      onImagePasteError: () => "",
      requestImageName: async () => null,
      preview: true,
    },
  );
  const extras = previewExtras();
  const editor = extras ? extras(core, docPathRef) : core;
  await editor.create();
  editor.action((ctx) => setReadOnly(ctx.get(editorViewCtx), true));
  return {
    update: (next) =>
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const doc = parseMarkdownSource(ctx, next);
        if (!doc) return;
        const tr = replaceChanged(
          view.state.tr,
          view.state.doc.content,
          doc.content,
        );
        if (tr) view.dispatch(pastReadOnly(tr.setMeta("addToHistory", false)));
      }),
    destroy: () => void editor.destroy(),
  };
}

export interface PreviewHandle {
  update: (markdown: string) => void;
  destroy: () => void;
}
