import { editorViewCtx } from "@milkdown/kit/core";
import { NodeSelection } from "@milkdown/kit/prose/state";
import { imageWidthOf, withImageWidth } from "./images/image-html";
import { turnedTitle } from "./images/image-rotation";
import { openDiagramViewer } from "./diagram-zoom";
import { revealNearest, type ImageLocation } from "./images/missing-image";
import { canRevealInFileManager } from "../platform/capabilities";
import type { EditorRunner } from "./useEditorRunner";
import type { Strings } from "../i18n/strings";
import type { MenuEntry } from "./editor-menu";

/** Pictures in the editor's menus. */

/** The doc position of the node-selected image, for the keyboard toolbar's
 *  image buttons. */
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

/** Selects the image at `pos` as a whole, so Quick Ask sends it. */
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
 * `keepSelected`: the image stays selected for the keyboard toolbar; new
 * markup on a leaf node otherwise maps a node selection to a caret.
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

/** A quarter turn clockwise (1) or counter-clockwise (-1), as one undoable
 *  step. A width still kept in the title moves to `width` on the way. */
export function rotateImage(run: EditorRunner, pos: number, turns: number) {
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    const node = view.state.doc.nodeAt(pos);
    if (node?.type.name !== "image") return;
    const tr = view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      title: turnedTitle(node.attrs.title as string, turns),
      width: imageWidthOf(node.attrs) ?? "",
    });
    // Still selected, so turning again needs no new click.
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    view.dispatch(tr);
    view.focus();
  });
}

/** View Image (once the picture has loaded) and the quarter turns. */
export function imageTurnItems(
  run: EditorRunner,
  t: Strings,
  imagePos: number,
): MenuEntry[] {
  const shown =
    run((ctx) => {
      const dom = ctx.get(editorViewCtx).nodeDOM(imagePos);
      // 1: an element (no DOM globals where tests run).
      if (dom?.nodeType !== 1) return null;
      const wrapper = dom as HTMLElement;
      const img = wrapper.querySelector("img");
      return img && img.naturalWidth > 0 ? { dom: wrapper, img } : null;
    }) ?? null;
  return [
    ...(shown
      ? [
          {
            label: t.imageViewLarge,
            onSelect: () => openDiagramViewer(shown.img, shown.dom),
          },
        ]
      : []),
    {
      label: t.imageRotateLeft,
      onSelect: () => rotateImage(run, imagePos, -1),
    },
    {
      label: t.imageRotateRight,
      onSelect: () => rotateImage(run, imagePos, 1),
    },
  ];
}

/**
 * Show in folder (the file, or the nearest folder that exists) and Copy
 * image path. A web image has only its address to copy; a data: URI, nothing.
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
