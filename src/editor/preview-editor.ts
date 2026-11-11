import { Editor, editorViewCtx } from "@milkdown/kit/core";
import { configureEditorRoot, withEditorCore } from "./editor-extensions";
import { parseMarkdownSource } from "./markdown/parse-markdown-source";
import { pastReadOnly, setReadOnly } from "./read-only-plugin";
import { loadSettings } from "../prefs/settings-store";
import type { Settings } from "../prefs/SettingsContext";
import "./preview-editor.css";
import { normalizeMathDelimiters } from "../utils/markdown-math";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { Transaction } from "@milkdown/kit/prose/state";

/** More for a preview to draw, from the layer above (plugins' blocks). */
export type PreviewExtras = (
  editor: Editor,
  docPath: { readonly current: string | null },
) => Editor;

let extras: PreviewExtras | null = null;

/** What the app adds to every preview (its plugins' blocks), told once. */
export function setPreviewExtras(add: PreviewExtras): void {
  extras = add;
}

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
  const editor = extras ? extras(core, docPathRef) : core;
  await editor.create();
  editor.action((ctx) => setReadOnly(ctx.get(editorViewCtx), true));
  return {
    update: (next) =>
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const doc = parseMarkdownSource(ctx, next);
        if (!doc) return;
        const tr = replaceChanged(view.state.tr, view.state.doc, doc);
        if (tr) view.dispatch(pastReadOnly(tr.setMeta("addToHistory", false)));
      }),
    destroy: () => void editor.destroy(),
  };
}

export interface PreviewHandle {
  update: (markdown: string) => void;
  destroy: () => void;
}

/** `tr` with only the top-level blocks of `old` that differ from `next`
 *  replaced, so the rest keep what they drew; null when nothing differs. */
export function replaceChanged(
  tr: Transaction,
  old: ProseNode,
  next: ProseNode,
): Transaction | null {
  const start = old.content.findDiffStart(next.content);
  if (start === null) return null;
  let { a, b } = old.content.findDiffEnd(next.content)!;
  const overlap = start - Math.min(a, b);
  if (overlap > 0) {
    a += overlap;
    b += overlap;
  }
  return tr.replace(start, a, next.slice(start, b));
}
