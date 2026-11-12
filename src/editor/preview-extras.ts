import type { Editor } from "@milkdown/kit/core";

/** More for a preview to draw, from the layer above (plugins' blocks). Its
 *  own module: the window tells it at startup without loading the editor. */
export type PreviewExtras = (
  editor: Editor,
  docPath: { readonly current: string | null },
) => Editor;

let extras: PreviewExtras | null = null;

/** What the app adds to every preview (its plugins' blocks), told once. */
export function setPreviewExtras(add: PreviewExtras): void {
  extras = add;
}

export function previewExtras(): PreviewExtras | null {
  return extras;
}
