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
import { rootedImagePath } from "./rooted-image";
import { LINK } from "../markdown/link-source";
import { parseLink } from "../markdown/link-syntax";
import { clipboardImageSources } from "./pasted-files";
import {
  shownImageWidth,
  splitAltSize,
  readImagePresentation,
  withImageWidth,
} from "./image-html";
import { imageRotationView } from "./image-rotation";
import { DROP_IMAGE_FILES_EVENT } from "../../utils/events";
import { decorateAll, redecorateChanged } from "../changed-ranges";
import { isLargeDoc } from "../large-doc";
import {
  type ImageStore,
  blobImageSrcs,
  changedRanges,
  pastedImages,
  fileImage,
  onlyLinkHrefs,
  replaceImage,
  saveAndInsertImages,
  storeBlobImages,
  swapStoredBlobs,
} from "./image-store";
import { openDiagramViewer, zoomButton } from "../diagram-zoom";
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
 * Image paste (stored in the document's image folder, relative src) and
 * render (local srcs rewritten to asset: URLs; the document keeps the original).
 */

export function resolveImageSrc(src: string, docPath: string | null): string {
  // A Windows drive path ("C:\..." / "C:/...") would otherwise read as a
  // single-letter URL scheme to the test below.
  if (isDrivePath(src)) return fileSrc(decodeUrlPath(src));
  if (!src || hasUrlScheme(src)) return src; // http(s), data:, asset:, file:, ...
  if (src.startsWith("/")) return fileSrc(decodeUrlPath(src));
  // Unsaved: left as written (shows missing). The sidebar folder is no
  // stand-in, since the document may be saved elsewhere.
  if (!docPath) return src;
  return fileSrc(`${dirname(docPath)}/${decodeUrlPath(src)}`);
}

/**
 * Points `img` at a document's image. The written src is kept as
 * data-doc-src for exports, since the shown asset: URL only works in-app.
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
  } else if (doc && !isScopedUrl(doc) && /^\/(?!\/)/.test(src)) {
    img.removeAttribute("src");
    void rootedImagePath(src, doc)
      .then((path) => {
        if (stillWanted()) img.src = fileSrc(path);
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

/** A link whose label is one image, `[![alt](src)](url)`: a badge. */
function isLinkedImage(source: string): boolean {
  const link = parseLink(source);
  if (!link) return false;
  // The label's range may hold its brackets: they're allowed around it.
  return /^\[?!\[[^\]]*\]\([^)]*\)\]?$/.test(
    source.slice(...link.label).trim(),
  );
}

/** A paragraph of only images and line breaks, laid out as a centred figure.
 *  Obsidian image embeds and linked images count. */
function isImageParagraph(node: ProseNode): boolean {
  if (node.type.name !== "paragraph" || node.childCount === 0) return false;
  let images = 0;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (
      child.type.name === "image" ||
      (child.type.name === "obsidian_embed" &&
        parseEmbed(child.textContent)?.isImage) ||
      (child.type.name === LINK && isLinkedImage(child.textContent))
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
 * The image node view. Inline-block, never display:block: an inline node as
 * a block gets a phantom caret line after it. The wrapper holds the resize handle.
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
  // Loaded, it opens in the viewer from its corner or a double click.
  const loaded = () => (img.naturalWidth > 0 ? img : null);
  const zoom = zoomButton(dom, loaded);
  img.addEventListener("dblclick", () => {
    if (loaded()) openDiagramViewer(img, dom);
  });
  dom.append(zoom);
  const showRotation = imageRotationView(dom, img);

  let current = node;
  // Which picture is on show: its src, in this document.
  const shown = () => `${docPath()}\n${(current.attrs.src as string) ?? ""}`;
  let card: HTMLElement | null = null;
  const clearMissing = () => {
    card?.remove();
    card = null;
    dom.classList.remove(MISSING_IMAGE_CLASS);
  };
  // A picture that won't load gets a card, once the backend has said why.
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
  // A short, wide strip (a README badge) has nothing to enlarge or
  // resize, and the controls would cover its words.
  img.addEventListener("load", () => {
    const badge =
      img.naturalHeight < BADGE_HEIGHT_PX &&
      img.naturalWidth >= 2 * img.naturalHeight;
    zoom.toggleAttribute("hidden", badge);
    handle.toggleAttribute("hidden", badge);
  });
  img.addEventListener("error", () => void showMissing());

  const apply = (n: ProseNode) => {
    const before = shown();
    current = n;
    // Another picture: the card goes, until that one fails too.
    if (shown() !== before) clearMissing();
    const { title } = readImagePresentation(n.attrs.title as string);
    const width = shownImageWidth(n.attrs);
    showDocImage(
      img,
      (n.attrs.src as string) ?? "",
      docPath(),
      () => current === n,
    );
    img.alt = splitAltSize((n.attrs.alt as string) ?? "").alt;
    if (title) img.title = title;
    else img.removeAttribute("title");
    dom.style.width = width ? cssWidth(width) : "";
    dom.classList.toggle("image-view-sized", width !== null);
    showRotation(n.attrs.title as string);
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
    const factor = getComputedStyle(paragraph).textAlign === "center" ? 2 : 1;
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
    // node drag or move the selection); so are the zoom and card buttons.
    stopEvent: (event: Event) =>
      event.target === handle ||
      zoom.contains(event.target as Node) ||
      isMissingCardAction(event),
    // Everything inside is written by this view - the live width while
    // resizing included - never by the user typing.
    ignoreMutation: () => true,
  };
}

/** A strip shorter than this, and twice as wide, is a badge. */
const BADGE_HEIGHT_PX = 48;

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
      // Tauri hands drops to the app, so they arrive as a window event. Every
      // tab's editor stays mounted; only the visible one takes them.
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
          const images = pastedImages(
            clipboardImageSources(event.clipboardData, onlyLinkHrefs(slice)),
          );
          if (images.length > 0) {
            void saveAndInsertImages(view, images, options);
            return true;
          }

          // A bitmap that reached us as HTML: paste it as it is, so the
          // image shows at once, then swap its blob: src for a stored one.
          const blobs = blobImageSrcs(slice);
          if (blobs.length > 0) {
            view.dispatch(
              view.state.tr
                .replaceSelection(slice)
                .setMeta("uiEvent", "paste")
                .scrollIntoView(),
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
