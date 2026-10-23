import type { Transaction } from "@milkdown/kit/prose/state";
import type { Slice } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { closeHistory } from "@milkdown/kit/prose/history";
import { resolveStrings } from "../../i18n/strings";
import { showMessage } from "../../ui/app-dialog";
import { errorText } from "../../utils/error-text";
import { fs } from "../../platform/ipc";
import type { Settings, ImageNamingMode } from "../../settings/SettingsContext";
import { IMAGE_FILE_EXTENSIONS, imageMimeForPath } from "./pasted-files";
import { unwrittenImageSrcs } from "../markdown/markdown-output";

/**
 * Pictures pasted, dropped or picked, saved where the writer keeps them:
 * a file name from the picture or the time, the image folder or a draft's
 * assets, pasted blobs swapped for their saved files, a picture replaced
 * (image-plugin.ts).
 */

export const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
};

export function blobToBase64(blob: Blob): Promise<string> {
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

export function automaticImageStem(): string {
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

export async function saveToImageFolder(
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

export function reportFailure(
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

export async function saveAndInsertImages(
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
export function blobImageSrcs(slice: Slice): string[] {
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
export async function storeBlobImages(
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
export function swapStoredBlobs(
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
export function changedRanges(trs: readonly Transaction[]): [number, number][] {
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
export function onlyLinkHrefs(slice: Slice): string[] {
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
export function fileImage(path: string): PastedImage {
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
export async function replaceImage(
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
