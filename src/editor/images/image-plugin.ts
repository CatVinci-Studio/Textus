import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode, Slice } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { closeHistory } from "@milkdown/kit/prose/history";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveStrings } from "../../i18n/strings";
import { showMessage } from "../../ui/app-dialog";
import { errorText } from "../../utils/error-text";
import {
  decodeUrlPath,
  dirname,
  hasUrlScheme,
  isDrivePath,
} from "../../utils/path";
import { fs } from "../../platform/ipc";
import {
  canPickImageFile,
  canRevealInFileManager,
} from "../../platform/capabilities";
import type { Settings, ImageNamingMode } from "../../settings/SettingsContext";
import { isScopedUrl, scopedImageSrc } from "../../platform/ios-files";
import {
  IMAGE_FILE_EXTENSIONS,
  imageFilesFromClipboard,
  imageMimeForPath,
} from "./pasted-files";
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
import { unwrittenImageSrcs } from "../markdown/markdown-output";
import { DROP_IMAGE_FILES_EVENT } from "../../utils/events";

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
  if (isDrivePath(src)) return convertFileSrc(decodeUrlPath(src));
  if (!src || hasUrlScheme(src)) return src; // http(s), data:, asset:, file:, ...
  if (src.startsWith("/")) return convertFileSrc(decodeUrlPath(src));
  // An unsaved document has no folder to resolve against, so a relative
  // path is left as written (the image shows as missing) and resolves once
  // the document is saved and reopened. The sidebar's open folder is not
  // used as a stand-in: the document may well be saved somewhere else, and
  // an image that showed before saving would then vanish.
  if (!docPath) return src;
  return convertFileSrc(`${dirname(docPath)}/${decodeUrlPath(src)}`);
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

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function safeImageStem(name: string): string {
  const withoutExtension = name.replace(/\.[^.]*$/, "");
  return (
    Array.from(withoutExtension)
      .filter((character) => (character.codePointAt(0) ?? 0) >= 32)
      .join("")
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/[. ]+$/g, "")
      .trim() || "image"
  );
}

function automaticImageStem(): string {
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  const random = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `${stamp}-${random}`;
}

export function imageStemForMode(
  file: { name: string },
  mode: ImageNamingMode,
): string {
  return mode === "auto" ? automaticImageStem() : safeImageStem(file.name);
}

/** An image to store. Its bytes are read only once it is known to be
 *  wanted, since a file-manager copy only names a file on disk. */
export interface PastedImage {
  name: string;
  type: string;
  base64: () => Promise<string>;
}

export interface ImageStore {
  docPath: () => string | null;
  settings: () => Settings;
  requestName: (stem: string, extension: string) => Promise<string | null>;
  onError: () => string;
}

/** Saves one image the way Settings > Images says - into the document's
 *  image folder, or up to the image host - and returns the src to
 *  write; null when it can't be stored or the user cancelled naming it. */
export async function storeImage(
  image: PastedImage,
  store: ImageStore,
): Promise<string | null> {
  const ext = EXT_BY_MIME[image.type];
  if (!ext) return null;
  const current = store.settings();
  if (current.imageStorageMode === "image-host") {
    const host = current.imageHost;
    if (host === "custom" && !current.imageUploadEndpoint.trim())
      throw new Error("image host upload endpoint is not configured");
    let stem = imageStemForMode(image, current.imageNamingMode);
    if (current.imageNamingMode === "ask") {
      const chosen = await store.requestName(stem, ext);
      if (chosen === null) return null;
      stem = safeImageStem(chosen);
    }
    // SM.MS and Imgur have their own address; PicGo's is the one its
    // server listens on.
    const { src } = await fs.uploadImage(
      host,
      await image.base64(),
      image.type,
      `${stem}.${ext}`,
      host === "picgo"
        ? current.imagePicgoEndpoint
        : current.imageUploadEndpoint,
      current.imageUploadUrlField || "url",
    );
    return src;
  }
  return saveToImageFolder(image, ext, store);
}

async function saveToImageFolder(
  image: PastedImage,
  ext: string,
  store: Pick<ImageStore, "docPath" | "settings">,
): Promise<string> {
  const { src } = await fs.savePastedImage(
    store.docPath(),
    await image.base64(),
    ext,
    store.settings().imageFolder,
  );
  return src;
}

/** Copies an image file into the document's image folder (Settings ›
 *  Images › Folder) whatever the storage mode, and returns its src there
 *  - for an Obsidian embed, which names a file in the vault and never an
 *  upload. Null for a file type the store doesn't take. */
export async function copyToImageFolder(
  path: string,
  store: Pick<ImageStore, "docPath" | "settings">,
): Promise<string | null> {
  const image = fileImage(path);
  const ext = EXT_BY_MIME[image.type];
  return ext ? saveToImageFolder(image, ext, store) : null;
}

function reportFailure(
  err: unknown,
  store: ImageStore,
  message = store.onError(),
): void {
  console.error("saving pasted image failed:", err);
  // The reason underneath: "PicGo isn't running" is something the user
  // can fix, where "couldn't save" alone left them guessing.
  void showMessage(`${message}\n${errorText(err)}`, {
    tone: "error",
  });
}

async function saveAndInsertImages(
  view: EditorView,
  images: PastedImage[],
  store: ImageStore,
): Promise<void> {
  for (const image of images) {
    try {
      const src = await storeImage(image, store);
      if (src === null) continue;
      const node = view.state.schema.nodes.image;
      if (!node) return;
      view.dispatch(
        view.state.tr
          .replaceSelectionWith(node.create({ src }))
          .scrollIntoView(),
      );
    } catch (err) {
      reportFailure(err, store);
    }
  }
}

/** The `blob:` srcs of the images in a slice. */
function blobImageSrcs(slice: Slice): string[] {
  const srcs = new Set<string>();
  slice.content.descendants((node) => {
    const src: unknown = node.attrs.src;
    if (
      node.type.name === "image" &&
      typeof src === "string" &&
      src.startsWith("blob:")
    )
      srcs.add(src);
  });
  return [...srcs];
}

/**
 * Stores each `blob:` image a paste just inserted and points it at the
 * stored copy. WebKitGTK hands a pasted screenshot to the page as HTML -
 * `<img src="blob:tauri://localhost/...">` - with no image file on the
 * clipboard event, so the file branch of handlePaste never saw it and the
 * blob URL went into the markdown: an image that showed until the document
 * was reopened, and then was gone (issue #59). The blob stays readable
 * while the page lives, which is all storing it needs.
 */
async function storeBlobImages(
  view: EditorView,
  srcs: string[],
  store: ImageStore,
  stored: Map<string, string>,
): Promise<void> {
  for (const blobSrc of srcs) unwrittenImageSrcs.add(blobSrc);
  for (const blobSrc of srcs) {
    try {
      const blob = await (await fetch(blobSrc)).blob();
      // WebKit makes these blobs from a bitmap, as PNG; an untyped one is
      // taken for PNG too rather than left to vanish.
      const type = blob.type.startsWith("image/") ? blob.type : "image/png";
      const src = await storeImage(
        { name: "image", type, base64: () => blobToBase64(blob) },
        store,
      );
      if (src === null) continue;
      stored.set(blobSrc, src);
      const tr = swapStoredBlobs(view.state.tr, stored, [
        [0, view.state.doc.content.size],
      ]);
      if (tr) view.dispatch(tr);
    } catch (err) {
      reportFailure(err, store);
    } finally {
      unwrittenImageSrcs.delete(blobSrc);
    }
  }
}

/**
 * Points every image in `ranges` whose src is a stored blob at the stored
 * file. Outside the history: the swap is not an edit of the user's, and as
 * its own undo step (a store slower than the history's grouping delay) an
 * undo put the blob: src back - an image that showed until reopen, issue
 * #59 again. An undo or redo can still bring a blob: image back (one
 * undone before its store landed, then redone), so the swap also runs on
 * whatever a transaction changes (appendTransaction below).
 */
function swapStoredBlobs(
  tr: Transaction,
  stored: Map<string, string>,
  ranges: [number, number][],
): Transaction | null {
  if (stored.size === 0) return null;
  for (const [from, to] of ranges)
    tr.doc.nodesBetween(from, to, (node, pos) => {
      const src = stored.get(node.attrs.src as string);
      if (node.type.name === "image" && src)
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, src });
    });
  return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
}

/** The ranges of the final document that `trs` replaced. */
function changedRanges(trs: readonly Transaction[]): [number, number][] {
  let ranges: [number, number][] = [];
  for (const tr of trs)
    for (const map of tr.mapping.maps) {
      ranges = ranges.map(([from, to]) => [map.map(from, -1), map.map(to, 1)]);
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        ranges.push([newStart, newEnd]);
      });
    }
  return ranges;
}

/** The link targets of a slice that holds links and nothing else. */
function onlyLinkHrefs(slice: Slice): string[] {
  const hrefs: string[] = [];
  let other = false;
  slice.content.descendants((node) => {
    if (other) return false;
    if (node.isText) {
      const href = node.marks.find((mark) => mark.type.name === "link")?.attrs
        .href as string | undefined;
      if (href) {
        if (hrefs[hrefs.length - 1] !== href) hrefs.push(href);
      } else if (node.text?.trim()) other = true;
    } else if (node.isLeaf && node.type.name !== "hardbreak") other = true;
    return true;
  });
  return other ? [] : hrefs;
}

/** An image file on disk, read through the backend once it's stored. */
function fileImage(path: string): PastedImage {
  return {
    name: path.slice(
      Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1,
    ),
    type: imageMimeForPath(path) ?? "",
    base64: () => fs.readBinaryFileBase64(path),
  };
}

/** Asks for an image file in the native picker; null when cancelled. */
export function pickImageFile(language: Settings["language"]) {
  return fs.openImageFileDialog(
    resolveStrings(language).missingImageFilter,
    IMAGE_FILE_EXTENSIONS,
  );
}

/**
 * "Choose image…" on a missing image's card: the picked file is stored as
 * a dropped one is - Settings › Images: copied into the image folder, or
 * uploaded - so the document gets the src a drop would give it, relative
 * to the document. Alt text and title stay; the change is one undo step
 * of its own.
 */
async function replaceImage(
  view: EditorView,
  getPos: () => number | undefined,
  store: ImageStore,
): Promise<void> {
  const language = store.settings().language;
  const path = await pickImageFile(language);
  if (!path) return;
  try {
    const src = await storeImage(fileImage(path), store);
    if (src === null) return;
    const pos = getPos();
    const node = pos === undefined ? null : view.state.doc.nodeAt(pos);
    if (pos === undefined || node?.type.name !== "image") return;
    view.dispatch(
      closeHistory(
        view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src }),
      ),
    );
  } catch (err) {
    reportFailure(
      err,
      store,
      resolveStrings(language).missingImageChooseFailed,
    );
  }
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

function imageParagraphDecorations(doc: ProseNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (isImageParagraph(node))
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: "image-paragraph",
          }),
        );
      return false;
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

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
        init: (_config, state) => imageParagraphDecorations(state.doc),
        apply: (tr, previous) =>
          tr.docChanged ? imageParagraphDecorations(tr.doc) : previous,
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
