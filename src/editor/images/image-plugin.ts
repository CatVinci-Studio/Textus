import { Plugin, PluginKey, type Transaction } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode, Slice } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { convertFileSrc } from "@tauri-apps/api/core";
import { showMessage } from "../../ui/app-dialog";
import { decodeLocalPath, dirname } from "../../utils/path";
import { fs } from "../../platform/ipc";
import type { Settings, ImageNamingMode } from "../../settings/SettingsContext";
import { isScopedUrl, scopedImageSrc } from "../../platform/ios-files";
import { imageFilesFromClipboard, imageMimeForPath } from "./pasted-files";
import { unwrittenImageSrcs } from "../markdown/markdown-output";
import {
  isGeneratedImage,
  openImageAt,
  rotateImageAt,
  sizeImageAt,
  stringsFor,
} from "./image-actions";

/**
 * Image support, Typora-style, in two halves:
 *
 * - PASTE: a bitmap on the clipboard (screenshot, copied image) is written
 *   to an `assets/` folder next to the current document by the
 *   save_pasted_image command, and an image node with the relative
 *   "assets/<name>" src is inserted - so the markdown stays portable.
 *   Unsaved drafts have no folder yet; their images land in the app data
 *   dir with an absolute src instead, moved next to the document when it
 *   is first saved (image-migration.ts). An image FILE copied in a file
 *   manager is stored the same way (pasted-files.ts).
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
  if (/^[a-z]:[\\/]/i.test(src)) return convertFileSrc(decodeLocalPath(src));
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src)) return src; // http(s), data:, asset:, file:, ...
  if (src.startsWith("/")) return convertFileSrc(decodeLocalPath(src));
  if (!docPath) return src;
  return convertFileSrc(`${dirname(docPath)}/${decodeLocalPath(src)}`);
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
  if (doc && isScopedUrl(doc) && !/^[a-z][a-z0-9+.-]*:|^\//i.test(src)) {
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

/** `{textus-width=N% textus-rotate=D}` - either part optional, any order;
 *  documents written by Levis say `levis-width`, read the same (and
 *  rewritten as `textus-width` when the width changes). */
const IMAGE_METADATA =
  /\s*\{((?:\s*(?:textus|levis)-(?:width=\d{1,3}%|rotate=\d{1,3}))+)\s*\}\s*$/;

export interface ImagePresentation {
  title: string;
  widthPercent: number | null;
  /** Clockwise quarter turns, in degrees: 0, 90, 180 or 270. */
  rotate: number;
}

/** Store image width and rotation in a standard Markdown title suffix. */
export function readImagePresentation(
  title: string | null | undefined,
): ImagePresentation {
  const value = title ?? "";
  const match = IMAGE_METADATA.exec(value);
  if (!match) return { title: value, widthPercent: null, rotate: 0 };
  const width = /-width=(\d{1,3})%/.exec(match[1]);
  const rotation = /-rotate=(\d{1,3})/.exec(match[1]);
  const percent = width ? Number(width[1]) : null;
  const degrees = rotation ? Number(rotation[1]) : 0;
  return {
    title: value.slice(0, match.index).trimEnd(),
    widthPercent:
      percent !== null && percent >= 1 && percent <= 100 ? percent : null,
    rotate: [90, 180, 270].includes(degrees) ? degrees : 0,
  };
}

function writeImagePresentation(
  visibleTitle: string,
  widthPercent: number | null,
  rotate: number,
): string | null {
  const parts = [
    widthPercent === null
      ? null
      : `textus-width=${Math.min(100, Math.max(1, Math.round(widthPercent)))}%`,
    rotate ? `textus-rotate=${rotate}` : null,
  ].filter(Boolean);
  const metadata = parts.length ? `{${parts.join(" ")}}` : "";
  const text = [visibleTitle.trimEnd(), metadata].filter(Boolean).join(" ");
  return text.length > 0 ? text : null;
}

export function writeImageWidth(
  title: string | null | undefined,
  widthPercent: number | null,
): string | null {
  const current = readImagePresentation(title);
  return writeImagePresentation(current.title, widthPercent, current.rotate);
}

/** Turns the image a quarter clockwise (1) or counter-clockwise (-1). */
export function writeImageRotation(
  title: string | null | undefined,
  quarterTurns: number,
): string | null {
  const current = readImagePresentation(title);
  const rotate = (((current.rotate + quarterTurns * 90) % 360) + 360) % 360;
  return writeImagePresentation(current.title, current.widthPercent, rotate);
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
interface PastedImage {
  name: string;
  type: string;
  base64: () => Promise<string>;
}

interface ImageStore {
  docPath: () => string | null;
  settings: () => Settings;
  requestName: (stem: string, extension: string) => Promise<string | null>;
  onError: () => string;
}

/** Saves one image the way Settings > Images says - into the document's
 *  assets/ folder, or up to the image host - and returns the src to
 *  write; null when it can't be stored or the user cancelled naming it. */
async function storeImage(
  image: PastedImage,
  store: ImageStore,
): Promise<string | null> {
  const ext = EXT_BY_MIME[image.type];
  if (!ext) return null;
  const current = store.settings();
  if (current.imageStorageMode === "image-host") {
    if (!current.imageUploadEndpoint.trim())
      throw new Error("image host upload endpoint is not configured");
    let stem = imageStemForMode(image, current.imageNamingMode);
    if (current.imageNamingMode === "ask") {
      const chosen = await store.requestName(stem, ext);
      if (chosen === null) return null;
      stem = safeImageStem(chosen);
    }
    const { src } = await fs.uploadImage(
      await image.base64(),
      image.type,
      `${stem}.${ext}`,
      current.imageUploadEndpoint,
      current.imageUploadUrlField || "url",
    );
    return src;
  }
  const { src } = await fs.savePastedImage(
    store.docPath(),
    await image.base64(),
    ext,
  );
  return src;
}

function reportFailure(err: unknown, store: ImageStore): void {
  console.error("saving pasted image failed:", err);
  void showMessage(store.onError(), { tone: "error" });
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

/** A paragraph holding nothing but images (and line breaks between them):
 *  the "an image on its own line" case, laid out as a centred figure. */
function isImageParagraph(node: ProseNode): boolean {
  if (node.type.name !== "paragraph" || node.childCount === 0) return false;
  let images = 0;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type.name === "image") images++;
    else if (child.type.name !== "hardbreak") return false;
  }
  return images > 0;
}

/** A picture's caption: a short paragraph that is all emphasis, right
 *  after the picture - `*Caption*`, the way the Agent writes one and the
 *  way markdown elsewhere shows it. */
export function isCaptionParagraph(node: ProseNode): boolean {
  if (node.type.name !== "paragraph" || node.childCount !== 1) return false;
  // Italics are an md_span node here (md-span-schema.ts): `*` once.
  const span = node.child(0);
  return (
    span.type.name === "md_span" &&
    (span.attrs.delim === "*" || span.attrs.delim === "_") &&
    span.attrs.rung === 1 &&
    span.textContent.trim().length > 0 &&
    span.textContent.length <= 200
  );
}

/** The caption under the picture at `pos`, if it has one (above), else its
 *  title's visible text. */
export function imageCaptionAt(doc: ProseNode, pos: number): string {
  const $pos = doc.resolve(pos);
  const image = doc.nodeAt(pos);
  const title = readImagePresentation(
    image?.attrs.title as string | null,
  ).title.trim();
  if ($pos.depth < 1) return title;
  const paragraph = $pos.node($pos.depth);
  const container = $pos.node($pos.depth - 1);
  const index = $pos.index($pos.depth - 1);
  const next =
    index + 1 < container.childCount ? container.child(index + 1) : null;
  if (isImageParagraph(paragraph) && next && isCaptionParagraph(next))
    return next.textContent.trim();
  return title;
}

function imageParagraphDecorations(doc: ProseNode): DecorationSet {
  const decorations: Decoration[] = [];
  // Whether the textblock visited just before was a picture's paragraph.
  let afterImage = false;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (isImageParagraph(node)) {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: "image-paragraph",
          }),
        );
        afterImage = true;
      } else {
        if (afterImage && isCaptionParagraph(node))
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: "image-caption",
            }),
          );
        afterImage = false;
      }
      return false;
    }
    if (!node.isBlock) return true;
    afterImage = false;
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
 * a share of the paragraph, stored in the title suffix like the context
 * menu's presets (writeImageWidth), so the markdown stays standard.
 */
const TOOL_ICONS: Record<string, string> = {
  view: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  left: '<path d="M4 4v6h6"/><path d="M4.5 15a8 8 0 1 0 2-8.5L4 10"/>',
  right: '<path d="M20 4v6h-6"/><path d="M19.5 15a8 8 0 1 1-2-8.5L20 10"/>',
  prompt: '<path d="M4 6h16M4 12h16M4 18h10"/>',
};

/** The floating bar over a hovered or selected image: preview, quarter
 *  turns, width presets and - for generated images - the prompt. */
function createImageToolbar(
  view: EditorView,
  getPos: () => number | undefined,
  docPath: () => string | null,
  language: () => string,
) {
  const bar = document.createElement("span");
  bar.className = "image-toolbar";
  bar.contentEditable = "false";
  const act = (fn: (pos: number) => void) => (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const pos = getPos();
    if (pos !== undefined) fn(pos);
  };
  const button = (
    label: string,
    content: string,
    fn: (pos: number) => void,
    icon = true,
  ) => {
    const b = document.createElement("button");
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    // Text labels are drawn by CSS (::before), so the image paragraph's
    // textContent stays empty for find, copy and screen readers alike.
    if (icon)
      b.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
    else b.dataset.label = content;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", act(fn));
    return b;
  };
  let promptButton: HTMLButtonElement | null = null;
  const build = (src: string, widthPercent: number | null) => {
    const t = stringsFor(language());
    const open = (showPrompt: boolean) => (pos: number) =>
      openImageAt(view, pos, {
        docPath: docPath(),
        language: language(),
        showPrompt,
      });
    bar.textContent = "";
    bar.append(
      button(t.imageViewLarge, TOOL_ICONS.view, open(false)),
      button(t.imageRotateLeft, TOOL_ICONS.left, (pos) =>
        rotateImageAt(view, pos, -1),
      ),
      button(t.imageRotateRight, TOOL_ICONS.right, (pos) =>
        rotateImageAt(view, pos, 1),
      ),
    );
    const sep = document.createElement("span");
    sep.className = "image-toolbar-sep";
    bar.append(sep);
    for (const [width, label] of [
      [null, t.imageWidthShortAuto],
      [30, "30%"],
      [50, "50%"],
      [70, "70%"],
      [100, "100%"],
    ] as const) {
      const b = button(
        label,
        label,
        (pos) => sizeImageAt(view, pos, width),
        false,
      );
      b.classList.add("image-toolbar-text");
      if (width === widthPercent) b.setAttribute("aria-pressed", "true");
      bar.append(b);
    }
    promptButton = isGeneratedImage(src)
      ? button(t.imageShowPrompt, TOOL_ICONS.prompt, open(true))
      : null;
    if (promptButton) {
      const sep2 = document.createElement("span");
      sep2.className = "image-toolbar-sep";
      bar.append(sep2, promptButton);
    }
  };
  return { bar, build };
}

// Printing lays out the whole document at once: every lazy picture loads.
if (typeof window !== "undefined")
  window.addEventListener("beforeprint", () => {
    for (const img of document.querySelectorAll<HTMLImageElement>(
      ".image-view img",
    ))
      img.loading = "eager";
  });

function createImageView(
  node: ProseNode,
  view: EditorView,
  getPos: () => number | undefined,
  docPath: () => string | null,
  language: () => string = () => "en",
) {
  const dom = document.createElement("span");
  dom.className = "image-view";
  const img = document.createElement("img");
  // Off-screen pictures are neither fetched nor decoded until scrolled
  // near - a decoded 1024² image holds about 4 MB.
  img.loading = "lazy";
  img.decoding = "async";
  const handle = document.createElement("span");
  handle.className = "image-resize-handle";
  handle.setAttribute("aria-hidden", "true");
  const toolbar = createImageToolbar(view, getPos, docPath, language);
  dom.append(img, handle, toolbar.bar);
  // A quarter turn swaps the footprint: the wrapper takes the turned
  // aspect ratio once the picture's own is known.
  const ratio = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    dom.style.setProperty(
      "--image-ratio",
      String(img.naturalWidth / img.naturalHeight),
    );
    // Turned and unsized: as wide as the picture is tall.
    dom.style.setProperty("--image-turned-width", `${img.naturalHeight}px`);
  };
  img.addEventListener("load", () => {
    ratio();
    dom.classList.remove("image-view-loading");
  });
  img.addEventListener("error", () =>
    dom.classList.remove("image-view-loading"),
  );

  let current = node;
  const apply = (n: ProseNode) => {
    // A new picture fades in when it arrives (a generated one replacing
    // its placeholder); a cached one is complete at once and just shows.
    if (n.attrs.src !== current.attrs.src || !img.src) {
      dom.classList.add("image-view-loading");
      queueMicrotask(() => {
        if (img.complete && img.naturalWidth)
          dom.classList.remove("image-view-loading");
      });
    }
    current = n;
    const presentation = readImagePresentation(n.attrs.title as string | null);
    showDocImage(
      img,
      (n.attrs.src as string) ?? "",
      docPath(),
      () => current === n,
    );
    img.alt = (n.attrs.alt as string) ?? "";
    if (presentation.title) img.title = presentation.title;
    else img.removeAttribute("title");
    dom.style.width = presentation.widthPercent
      ? `${presentation.widthPercent}%`
      : "";
    dom.classList.toggle("image-view-sized", !!presentation.widthPercent);
    dom.dataset.rotate = String(presentation.rotate);
    dom.classList.toggle(
      "image-view-turned",
      presentation.rotate === 90 || presentation.rotate === 270,
    );
    ratio();
    toolbar.build((n.attrs.src as string) ?? "", presentation.widthPercent);
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

    let moved = false;
    const move = (e: PointerEvent) => {
      moved ||= Math.abs(e.clientX - startX) > 2;
      const width = startWidth + (e.clientX - startX) * factor;
      percent = Math.min(100, Math.max(5, (width / scale / available) * 100));
      dom.style.width = `${percent}%`;
    };
    const finish = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      dom.classList.remove("image-view-resizing");
      // A click on the handle without a drag changes nothing.
      if (!moved) return;
      const pos = getPos();
      if (pos === undefined) return;
      view.dispatch(
        view.state.tr.setNodeMarkup(pos, undefined, {
          ...current.attrs,
          title: writeImageWidth(
            current.attrs.title as string | null,
            Math.round(percent),
          ),
        }),
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
    // The handle's drag and the toolbar's clicks are ours, not
    // ProseMirror's (which would start a node drag or move the selection).
    stopEvent: (event: Event) =>
      event.target === handle ||
      (event.target instanceof Node && toolbar.bar.contains(event.target)),
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
      props: {
        decorations: (state) => imageParagraphKey.getState(state),
        // Double-click opens the full-window preview. Through ProseMirror's
        // own double-click detection: a listener on the <img> loses the
        // second click to the node selection the first one made.
        handleDoubleClickOn(view, _pos, node, nodePos) {
          if (node.type.name !== "image") return false;
          openImageAt(view, nodePos, {
            docPath: options.docPath(),
            language: options.settings().language,
          });
          return true;
        },
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
            createImageView(
              node,
              view,
              getPos,
              options.docPath,
              () => options.settings().language,
            ),
        },
      },
    });
  });
}
