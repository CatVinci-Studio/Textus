import type { EditorView } from "@milkdown/kit/prose/view";
import { NodeSelection } from "@milkdown/kit/prose/state";
import { resolveStrings, type Lang, type Strings } from "../../i18n/strings";
import { media } from "../../platform/ipc";
import {
  readImagePresentation,
  resolveImageSrc,
  writeImageRotation,
  writeImageWidth,
} from "./image-plugin";
import { openImageViewer, type ImageViewerLabels } from "./image-viewer";

/** Images Textus generated are stored as `image-<id>-<n>-<k>.<ext>`
 *  (media/jobs.rs); pasted ones are named by date or after the file. */
export function isGeneratedImage(src: string): boolean {
  // A Save As collision adds "-1", "-2"… to the name (fs.rs).
  return /(?:^|[\\/])image-\d+-\d+-\d+(?:-\d+)*\.(?:png|jpe?g|webp)$/i.test(
    src.split(/[?#]/)[0],
  );
}

export function viewerLabels(t: Strings): ImageViewerLabels {
  return {
    zoomIn: t.imageZoomIn,
    zoomOut: t.imageZoomOut,
    rotateLeft: t.imageRotateLeft,
    rotateRight: t.imageRotateRight,
    close: t.imageViewerClose,
    prompt: t.imagePromptTitle,
    promptMissing: t.imagePromptMissing,
    copyPrompt: t.imageCopyPrompt,
    copied: t.loginLinkCopied,
  };
}

export function stringsFor(language: string): Strings {
  return resolveStrings(language as Lang);
}

function imageAt(view: EditorView, pos: number) {
  const node = view.state.doc.nodeAt(pos);
  return node?.type.name === "image" ? node : null;
}

/** Rewrites one image's title metadata as one undoable step, keeping it
 *  selected so its toolbar stays put. */
function updateTitle(
  view: EditorView,
  pos: number,
  write: (title: string | null) => string | null,
) {
  const node = imageAt(view, pos);
  if (!node) return;
  const tr = view.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    title: write(node.attrs.title as string | null),
  });
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  view.dispatch(tr);
}

export function rotateImageAt(view: EditorView, pos: number, turns: number) {
  updateTitle(view, pos, (title) => writeImageRotation(title, turns));
}

export function sizeImageAt(
  view: EditorView,
  pos: number,
  widthPercent: number | null,
) {
  updateTitle(view, pos, (title) => writeImageWidth(title, widthPercent));
}

/** The full-window preview for the image at `pos`; its rotation buttons
 *  turn the document's image too. */
export function openImageAt(
  view: EditorView,
  pos: number,
  options: { docPath: string | null; language: string; showPrompt?: boolean },
) {
  const node = imageAt(view, pos);
  if (!node) return;
  const src = (node.attrs.src as string) ?? "";
  const t = stringsFor(options.language);
  openImageViewer({
    src: resolveImageSrc(src, options.docPath),
    alt: (node.attrs.alt as string) ?? "",
    rotate: readImagePresentation(node.attrs.title as string | null).rotate,
    labels: viewerLabels(t),
    showPrompt: options.showPrompt,
    loadPrompt: isGeneratedImage(src)
      ? () => media.imagePrompt(src)
      : undefined,
    onRotate: (turns) => {
      // The image may have moved while the preview was open.
      const at = imageAtSrc(view, src) ?? pos;
      rotateImageAt(view, at, turns);
    },
  });
}

function imageAtSrc(view: EditorView, src: string): number | null {
  let found: number | null = null;
  view.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === "image" && node.attrs.src === src) found = pos;
    return true;
  });
  return found;
}
