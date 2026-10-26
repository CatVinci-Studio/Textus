import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { fileSrc } from "../../platform/file-src";
import { resolveStrings } from "../../i18n/strings";
import {
  decodeUrlPath,
  dirname,
  hasUrlScheme,
  isDrivePath,
} from "../../utils/path";
import {
  canPickImageFile,
  canRevealInFileManager,
} from "../../platform/capabilities";
import { isScopedUrl, scopedImageSrc } from "../../platform/ios-files";
import { imageFilesFromClipboard } from "./pasted-files";
import {
  MISSING_IMAGE_CLASS,
  imageDisplayName,
  imageLocation,
  isMissingCardAction,
  missingImageCard,
  probeMissing,
  revealNearest,
} from "./missing-image";
import { parseEmbed } from "./obsidian-embed";
import {
  imageWidthOf,
  readImagePresentation,
  withImageWidth,
} from "./image-html";
import { DROP_IMAGE_FILES_EVENT } from "../../utils/events";
import { decorateAll, redecorateChanged } from "../changed-ranges";
import { isLargeDoc } from "../large-doc";
import {
  type ImageStore,
  blobImageSrcs,
  blobToBase64,
  changedRanges,
  fileImage,
  onlyLinkHrefs,
  replaceImage,
  saveAndInsertImages,
  storeBlobImages,
  swapStoredBlobs,
} from "./image-store";
export {
  safeImageStem,
  imageStemForMode,
  type PastedImage,
  type ImageStore,
  storeImage,
  copyToImageFolder,
  pickImageFile,
} from "./image-store";
/**
 * Image support, Typora-style, in two halves:
 *
 * - PASTE: a bitmap on the clipboard (screenshot, copied image) is written
 *   to the current document's image folder (Settings > Images, `assets/`
 *   next to it by default) by the save_pasted_image command, and an image
 *   node with the relative src is inserted - so the markdown stays
 *   portable. Unsaved drafts have no folder yet; their images land in the
 *   app data dir with an absolute src instead, moved into the image folder
 *   when the document is first saved (image-migration.ts). An image FILE copied in a file
 *   manager is stored the same way (pasted-files.ts), and so is one
 *   dropped on the window (app/dropped-files.ts).
 *
 * - RENDER: the webview can't load local files directly, so a nodeView
 *   rewrites local srcs through Tauri's asset protocol at display time -
 *   relative paths resolved against the document's folder. The document
 *   itself keeps the original src; only the <img> element sees the
 *   asset: URL.
 */

export function resolveImageSrc(src: string, docPath: string | null): string {
  // A Windows drive path ("C:\..." / "C:/...") would otherwise read as a
  // single-letter URL scheme to the test below.
  if (isDrivePath(src)) return fileSrc(decodeUrlPath(src));
  if (!src || hasUrlScheme(src)) return src; // http(s), data:, asset:, file:, ...
  if (src.startsWith("/")) return fileSrc(decodeUrlPath(src));
  // An unsaved document has no folder to resolve against, so a relative
  // path is left as written (the image shows as missing) and resolves once
  // the document is saved and reopened. The sidebar's open folder is not
  // used as a stand-in: the document may well be saved somewhere else, and
  // an image that showed before saving would then vanish.
  if (!docPath) return src;
  return fileSrc(`${dirname(docPath)}/${decodeUrlPath(src)}`);
}

/**
 * Points `img` at a document's image: a relative src resolves against the
 * document's folder, read through the iOS plugin beside a document picked
 * in Files. The written src is kept as data-doc-src for exports - the one
 * shown is an asset: URL that only resolves inside this app. Shared by
 * markdown images and the raw-HTML <img> preview.
 */
export function showDocImage(
  img: HTMLImageElement,
  src: string,
  doc: string | null,
  stillWanted: () => boolean = () => true,
): void {
  img.decoding = "async";
  if (doc && isScopedUrl(doc) && !hasUrlScheme(src) && !src.startsWith("/")) {
    img.removeAttribute("src");
    void scopedImageSrc(src, doc)
      .then((url) => {
        if (stillWanted()) img.src = url;
      })
      .catch(() => {});
  } else {
    img.src = resolveImageSrc(src, doc);
  }
  img.dataset.docSrc = src;
}

/** The width as CSS: a bare number is pixels, as in HTML. */
function cssWidth(width: string): string {
  return /^\d+$/.test(width) ? `${width}px` : width;
}

/** A paragraph holding nothing but images (and line breaks between them):
 *  the "an image on its own line" case, laid out as a centred figure. An
 *  Obsidian image embed (obsidian-embed.ts) counts as an image. */
function isImageParagraph(node: ProseNode): boolean {
  if (node.type.name !== "paragraph" || node.childCount === 0) return false;
  let images = 0;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (
      child.type.name === "image" ||
      (child.type.name === "obsidian_embed" &&
        parseEmbed(child.textContent)?.isImage)
    )
      images++;
    else if (child.type.name !== "hardbreak") return false;
  }
  return images > 0;
}

const isTextblock = (node: ProseNode) => node.isTextblock;

const imageParagraph = (node: ProseNode, pos: number) =>
  isImageParagraph(node)
    ? [Decoration.node(pos, pos + node.nodeSize, { class: "image-paragraph" })]
    : [];

const imageParagraphKey = new PluginKey<DecorationSet>("image-paragraph");

/**
 * The image node view. Commonmark's image is an INLINE node, and it stays
 * one: rendering it as display:block (as this used to) put ProseMirror's
 * trailing caret line box underneath it - a phantom empty line after every
 * image, and a caret that painted in the wrong place. So the image renders
 * inline-block inside a wrapper, the way an inline node can actually
 * behave, and an image standing alone in its paragraph gets the centred
 * figure layout from that paragraph instead (image-paragraph above).
 *
 * The wrapper also carries the resize handle: dragging it sets the width as
 * a share of the paragraph, saved like the context menu's presets
 * (withImageWidth).
 */
function createImageView(
  node: ProseNode,
  view: EditorView,
  getPos: () => number | undefined,
  store: ImageStore,
) {
  const { docPath } = store;
  const dom = document.createElement("span");
  dom.className = "image-view";
  const img = document.createElement("img");
  // In a large document, loaded only as it comes near the screen (set
  // before the src, or it loads at once).
  if (isLargeDoc(view.state.doc)) img.loading = "lazy";
  const handle = document.createElement("span");
  handle.className = "image-resize-handle";
  handle.setAttribute("aria-hidden", "true");
  dom.append(img, handle);

  let current = node;
  // Which picture is on show: its src, in this document.
  const shown = () => `${docPath()}\n${(current.attrs.src as string) ?? ""}`;
  let card: HTMLElement | null = null;
  const clearMissing = () => {
    card?.remove();
    card = null;
    dom.classList.remove(MISSING_IMAGE_CLASS);
  };
  // A picture that won't load gets its card instead of the broken-image
  // icon (missing-image.ts), once the backend has said why.
  const showMissing = async () => {
    const key = shown();
    const src = (current.attrs.src as string) ?? "";
    const location = imageLocation(src, docPath());
    const reason = await probeMissing(location);
    if (key !== shown() || (img.complete && img.naturalWidth > 0)) return;
    const next = missingImageCard(
      {
        name: imageDisplayName(src),
        alt: (current.attrs.alt as string) ?? "",
        reason,
        location,
        onChoose: canPickImageFile
          ? () => void replaceImage(view, getPos, store)
          : undefined,
        onReveal:
          canRevealInFileManager && location.kind === "local"
            ? () => revealNearest(location.path)
            : undefined,
      },
      resolveStrings(store.settings().language),
    );
    clearMissing();
    card = next;
    dom.classList.add(MISSING_IMAGE_CLASS);
    dom.append(card);
  };
  img.addEventListener("load", clearMissing);
  img.addEventListener("error", () => void showMissing());

  const apply = (n: ProseNode) => {
    const before = shown();
    current = n;
    // Another picture: the card goes, until that one fails too.
    if (shown() !== before) clearMissing();
    const { title } = readImagePresentation(n.attrs.title as string);
    const width = imageWidthOf(n.attrs);
    showDocImage(
      img,
      (n.attrs.src as string) ?? "",
      docPath(),
      () => current === n,
    );
    img.alt = (n.attrs.alt as string) ?? "";
    if (title) img.title = title;
    else img.removeAttribute("title");
    dom.style.width = width ? cssWidth(width) : "";
    dom.classList.toggle("image-view-sized", width !== null);
  };
  apply(node);

  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const paragraph = dom.parentElement;
    if (!paragraph) return;
    const available = paragraph.clientWidth;
    const startWidth = dom.getBoundingClientRect().width;
    const startX = event.clientX;
    // A centred image grows from both sides, so the edge under the pointer
    // moves half as far as the width changes.
    const factor = paragraph.classList.contains("image-paragraph") ? 2 : 1;
    // Rendered px -> layout px: the editor content is zoomed with CSS zoom.
    const scale = startWidth / Math.max(1, dom.offsetWidth);
    let percent = (startWidth / scale / available) * 100;
    handle.setPointerCapture(event.pointerId);
    dom.classList.add("image-view-resizing");

    const move = (e: PointerEvent) => {
      const width = startWidth + (e.clientX - startX) * factor;
      percent = Math.min(100, Math.max(5, (width / scale / available) * 100));
      dom.style.width = `${percent}%`;
    };
    const finish = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      dom.classList.remove("image-view-resizing");
      const pos = getPos();
      if (pos === undefined) return;
      view.dispatch(
        view.state.tr.setNodeMarkup(
          pos,
          undefined,
          withImageWidth(current.attrs, percent),
        ),
      );
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  });

  return {
    dom,
    update: (n: ProseNode) => {
      if (n.type.name !== "image") return false;
      apply(n);
      return true;
    },
    selectNode: () => dom.classList.add("ProseMirror-selectednode"),
    deselectNode: () => dom.classList.remove("ProseMirror-selectednode"),
    // The handle's drag is ours, not ProseMirror's (which would start a
    // node drag or move the selection); so are the card's buttons.
    stopEvent: (event: Event) =>
      event.target === handle || isMissingCardAction(event),
    // Everything inside is written by this view - the live width while
    // resizing included - never by the user typing.
    ignoreMutation: () => true,
  };
}

export function createImagePlugin(options: ImageStore) {
  return $prose(() => {
    // Each pasted blob: src and the stored src that replaced it.
    const storedBlobs = new Map<string, string>();
    return new Plugin<DecorationSet>({
      key: imageParagraphKey,
      state: {
        init: (_config, state) =>
          decorateAll(state.doc, isTextblock, imageParagraph),
        apply: (tr, previous) =>
          redecorateChanged(previous, tr, isTextblock, imageParagraph),
      },
      appendTransaction: (trs, _old, state) =>
        trs.some((tr) => tr.docChanged)
          ? swapStoredBlobs(state.tr, storedBlobs, changedRanges(trs))
          : null,
      // Image files dropped on the window: Tauri hands the drop to the app
      // (app/useFileOpening.ts's useFileDrop), not to this view, so it comes
      // as a window event. Every tab's editor stays mounted, hidden but the
      // one on screen - only that one takes them.
      view: (view) => {
        const onDrop = (e: Event) => {
          if (view.dom.offsetParent === null) return;
          const { paths, point } = (
            e as CustomEvent<{
              paths: string[];
              point: { x: number; y: number };
            }>
          ).detail;
          const at = view.posAtCoords({ left: point.x, top: point.y });
          // Off the text (the sidebar, the margins): at the caret instead.
          if (at)
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.near(view.state.doc.resolve(at.pos)),
              ),
            );
          view.focus();
          void saveAndInsertImages(view, paths.map(fileImage), options);
        };
        window.addEventListener(DROP_IMAGE_FILES_EVENT, onDrop);
        return {
          destroy: () =>
            window.removeEventListener(DROP_IMAGE_FILES_EVENT, onDrop),
        };
      },
      props: {
        decorations: (state) => imageParagraphKey.getState(state),
        handlePaste(view, event, slice) {
          const data = event.clipboardData;
          const items = Array.from(data?.items ?? []);
          let files = items
            .filter(
              (item) => item.kind === "file" && item.type.startsWith("image/"),
            )
            .map((item) => item.getAsFile())
            .filter((f): f is File => f !== null);
          // Some webviews list a pasted file under `files` alone.
          if (files.length === 0)
            files = Array.from(data?.files ?? []).filter((f) =>
              f.type.startsWith("image/"),
            );
          if (files.length > 0) {
            void saveAndInsertImages(
              view,
              files.map((file) => ({
                name: file.name,
                type: file.type,
                base64: () => blobToBase64(file),
              })),
              options,
            );
            return true;
          }

          // Image files copied in a file manager: inserted as images and
          // stored like a pasted bitmap, instead of as file:// links.
          const paths = imageFilesFromClipboard({
            uriList: data?.getData("text/uri-list"),
            gnomeCopiedFiles: data?.getData("x-special/gnome-copied-files"),
            linkHrefs: onlyLinkHrefs(slice),
          });
          if (paths.length > 0) {
            void saveAndInsertImages(view, paths.map(fileImage), options);
            return true;
          }

          // A bitmap that reached us as HTML: paste it as it is, so the
          // image shows at once, then swap its blob: src for a stored one.
          const blobs = blobImageSrcs(slice);
          if (blobs.length > 0) {
            view.dispatch(
              view.state.tr.replaceSelection(slice).scrollIntoView(),
            );
            void storeBlobImages(view, blobs, options, storedBlobs);
            return true;
          }
          return false;
        },
        nodeViews: {
          image: (node, view, getPos) =>
            createImageView(node, view, getPos, options),
        },
      },
    });
  });
}
