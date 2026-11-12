import type { Editor } from "@milkdown/kit/core";

/** More for a preview to draw, from the layer above (plugins' blocks). Its
 *  own module: the window tells it at startup without loading the editor. */
export type PreviewExtras = (
  editor: Editor,
  docPath: { readonly current: string | null },
) => Editor;

let extras: (() => Promise<PreviewExtras>) | null = null;

/** What the app adds to every preview (its plugins' blocks), told once:
 *  loaded with the first preview, not with the window. */
export function setPreviewExtras(load: () => Promise<PreviewExtras>): void {
  extras = load;
}

export function previewExtras(): Promise<PreviewExtras | null> {
  return extras ? extras() : Promise.resolve(null);
}
