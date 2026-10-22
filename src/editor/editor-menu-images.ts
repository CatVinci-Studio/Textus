import { editorViewCtx } from "@milkdown/kit/core";
import { NodeSelection } from "@milkdown/kit/prose/state";
import { imageWidthOf, withImageWidth } from "./images/image-html";
import { revealNearest, type ImageLocation } from "./images/missing-image";
import { canRevealInFileManager } from "../platform/capabilities";
import type { EditorRunner } from "./useEditorRunner";
import type { Strings } from "../i18n/strings";
import type { MenuEntry } from "./editor-menu";

/**
 * Pictures in the editor's menus: the selected one, its width, deleting
 * or replacing it, and the menu items (editor-menu.ts).
 */

/** The image the selection is on - a tapped image is node-selected - for
 *  the keyboard toolbar's image buttons: its doc position, as
 *  contextMenuTarget reports the right-clicked one. */
export function selectedImagePos(run: EditorRunner): number | null {
  return (
    run((ctx) => {
      const { selection } = ctx.get(editorViewCtx).state;
      return selection instanceof NodeSelection &&
        selection.node.type.name === "image"
        ? selection.from
        : null;
    }) ?? null
  );
}

/** Selects the image at `pos` as a whole, for Textus AI to be asked
 *  about it (the selection is what Quick Ask sends). */
export function selectImage(run: EditorRunner, pos: number) {
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    const node = view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "image") return;
    view.dispatch(
      view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)),
    );
  });
}

export function deleteImage(run: EditorRunner, pos: number) {
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    const node = view.state.doc.nodeAt(pos);
    if (node?.type.name !== "image") return;
    view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
    view.focus();
  });
}

/**
 * `keepSelected`: the image stays selected, as the keyboard toolbar needs
 * it to keep showing the image's buttons - new markup on a leaf node is a
 * replacement, which otherwise maps a node selection on it to a caret.
 */
export function setImageWidth(
  run: EditorRunner,
  pos: number,
  widthPercent: number | null,
  keepSelected = false,
) {
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    const node = view.state.doc.nodeAt(pos);
    if (node?.type.name !== "image") return;
    const tr = view.state.tr.setNodeMarkup(
      pos,
      undefined,
      withImageWidth(node.attrs, widthPercent),
    );
    if (keepSelected) tr.setSelection(NodeSelection.create(tr.doc, pos));
    view.dispatch(tr);
    view.focus();
  });
}

export function imageWidthItems(
  run: EditorRunner,
  t: Strings,
  imagePos: number,
): MenuEntry[] {
  const currentWidth =
    run((ctx) => {
      const node = ctx.get(editorViewCtx).state.doc.nodeAt(imagePos);
      return node?.type.name === "image" ? imageWidthOf(node.attrs) : null;
    }) ?? null;
  // A width written by hand - "320", "45%" - ticks none of them.
  const widthItem = (widthPercent: number | null, label: string) => ({
    label: `${currentWidth === (widthPercent && `${widthPercent}%`) ? "✓ " : ""}${label}`,
    onSelect: () => setImageWidth(run, imagePos, widthPercent),
  });
  return [
    widthItem(null, t.imageWidthAuto),
    widthItem(30, t.imageWidth30),
    widthItem(50, t.imageWidth50),
    widthItem(70, t.imageWidth70),
    widthItem(100, t.imageWidth100),
  ];
}

/**
 * Show in folder and Copy image path. Show in folder goes where the
 * missing image card's button does (revealNearest): the file selected, or
 * the nearest folder that exists. A web image has only its address to
 * copy; a data: URI, nothing.
 */
export function imageFileItems(
  t: Strings,
  location: ImageLocation | null,
): MenuEntry[] {
  const items: MenuEntry[] = [];
  if (location?.kind === "local" && canRevealInFileManager)
    items.push({
      label: t.imageReveal,
      onSelect: () => revealNearest(location.path),
    });
  const text =
    location?.kind === "local"
      ? location.path
      : location?.kind === "remote"
        ? location.url
        : null;
  if (text !== null)
    items.push({
      label: t.imageCopyPath,
      onSelect: () => void navigator.clipboard.writeText(text).catch(() => {}),
    });
  return items;
}
