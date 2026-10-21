import { ai, type GeneratedImageData } from "../../platform/ipc";
import { EDIT_ACTIONS, type EditAction, type EditProposal } from "../types";

/**
 * The pictures generate_image proposes (src-tauri ai/images.rs). The
 * picture waits in the backend, in memory, until Accept saves it the way
 * Settings › Images says; until then the proposal's Markdown names it by a
 * placeholder src, and only the preview in the document - never the
 * conversation, which is saved - holds its bytes, as a data: URL.
 */

const PREFIX = "textus-generated:";

/** The src a waiting picture has in its proposal's text. */
export function generatedImageSrc(id: string): string {
  return `${PREFIX}${id}`;
}

const PLACEHOLDER = /textus-generated:([0-9a-z]+)/g;

/** An image on its own as alt text, without what would end it early. */
function cleanAlt(alt: string): string {
  return alt.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * A generate_image call's arguments as a proposal - once with_images
 * (ai/images.rs) recorded the picture in them; null for one that made
 * none (its result says why).
 */
export function parseImageProposal(argumentsJson: string): EditProposal | null {
  try {
    const parsed = JSON.parse(argumentsJson);
    const image = parsed.image;
    if (!image || typeof image.id !== "string") return null;
    // Its frame's shape, wherever it is drawn - in a text that carries it
    // (`in_text`) as much as on its own.
    sizes.set(image.id, {
      width: Number(image.width) || 0,
      height: Number(image.height) || 0,
    });
    const action = parsed.action as EditAction;
    if (!EDIT_ACTIONS.includes(action)) return null;
    const anchor =
      typeof parsed.anchor === "string" && parsed.anchor
        ? parsed.anchor
        : undefined;
    if ((action === "insert_after" || action === "insert_before") && !anchor)
      return null;
    const alt = cleanAlt(typeof parsed.alt === "string" ? parsed.alt : "");
    return {
      action,
      anchor,
      context:
        typeof parsed.context === "string" && parsed.context
          ? parsed.context
          : undefined,
      text: `![${alt}](${generatedImageSrc(image.id)})`,
      image: {
        id: image.id,
        alt,
        width: Number(image.width) || 0,
        height: Number(image.height) || 0,
        pending: image.pending === true,
      },
    };
  } catch {
    return null;
  }
}

const loaded = new Map<string, GeneratedImageData & { url: string }>();
const loading = new Map<string, Promise<boolean>>();
/** Why a picture wasn't made, in the service's words. */
const failed = new Map<string, string>();
/** The size each picture was asked for: its frame's shape meanwhile. */
const sizes = new Map<string, { width: number; height: number }>();

/** Fetches a picture from the backend once - which answers when it is
 *  made, so a picture still painting waits here - for the preview to draw
 *  it; false when it wasn't made (generatedImageFailure says why) or is
 *  gone (the backend keeps the newest 16, and nothing across a restart). */
export function loadGeneratedImage(id: string): Promise<boolean> {
  if (loaded.has(id)) return Promise.resolve(true);
  if (failed.has(id)) return Promise.resolve(false);
  let pending = loading.get(id);
  if (!pending) {
    pending = ai
      .generatedImage(id)
      .then((data) => {
        loaded.set(id, {
          ...data,
          url: `data:${data.mime};base64,${data.dataBase64}`,
        });
        return true;
      })
      .catch((err: unknown) => {
        failed.set(id, err instanceof Error ? err.message : String(err));
        return false;
      })
      .finally(() => {
        loading.delete(id);
        for (const listener of listeners) listener();
      });
    loading.set(id, pending);
  }
  return pending;
}

/** Told whenever a picture has come, or failed to. */
const listeners = new Set<() => void>();

export function onPictureSettled(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Where a picture is: still being made, here (or saved by an earlier
 *  Accept), or not made. */
export type PictureState = "painting" | "ready" | "failed";

export function pictureState(id: string): PictureState {
  if (loaded.has(id) || saved.has(id)) return "ready";
  if (failed.has(id)) return "failed";
  return "painting";
}

/** The ids of the waiting pictures in a proposal's Markdown, in order. */
export function generatedIdsIn(markdown: string): string[] {
  return [...markdown.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

/** Where a proposal's waiting pictures are, taken together: any still
 *  being made, any not made - or "ready" (also with none at all). */
export function picturesState(markdown: string): PictureState {
  const states = generatedIdsIn(markdown).map(pictureState);
  if (states.includes("painting")) return "painting";
  if (states.includes("failed")) return "failed";
  return "ready";
}

/** The alt text picture `id` has in `markdown`. */
export function generatedAlt(markdown: string, id: string): string {
  const at = markdown.indexOf(generatedImageSrc(id));
  const open = at < 0 ? -1 : markdown.lastIndexOf("![", at);
  if (open < 0) return "";
  return markdown.slice(open + 2, at).replace(/\]\($/, "");
}

/** `markdown` without picture `id` - one that wasn't made, left out of
 *  the text that carried it - and the blank line it stood on. */
export function withoutPicture(markdown: string, id: string): string {
  const src = generatedImageSrc(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown
    .replace(new RegExp(`\\n*!\\[[^\\]]*\\]\\(${src}\\)\\n*`), "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

/** Why a picture wasn't made, once its load has said so. */
export function generatedImageFailure(id: string): string | null {
  return failed.get(id) ?? null;
}

/** The size a picture was asked for, for its frame. */
export function generatedImageSize(
  id: string,
): { width: number; height: number } | null {
  return sizes.get(id) ?? null;
}

/** A transparent pixel standing in for a picture not loaded yet, its id
 *  carried as a media-type parameter: the preview's Markdown renderer
 *  keeps a data: src and drops one in our own scheme. */
const STUB = (id: string) =>
  `data:image/gif;textus-generated=${id};base64,R0lGODlhAQABAAAAACw=`;
const STUB_ID = /^data:image\/gif;textus-generated=([0-9a-z]+);/;

/** The id of a picture not loaded yet, from its src in the preview - the
 *  stand-in showGeneratedImages put there, or the proposal's own
 *  placeholder - or null. */
export function generatedImageId(src: string): string | null {
  if (src.startsWith(PREFIX)) return src.slice(PREFIX.length);
  return STUB_ID.exec(src)?.[1] ?? null;
}

/** A loaded picture's bytes, for saving it. */
export function generatedImageData(id: string): GeneratedImageData | null {
  return loaded.get(id) ?? null;
}

/** A loaded picture as a data: URL, or null until it has loaded. */
export function generatedImageUrl(id: string): string | null {
  return loaded.get(id)?.url ?? null;
}

/** Markdown for the preview: each waiting picture's placeholder src as
 *  its data: URL - or, for one not loaded yet (still being made), a
 *  stand-in that pending-picture.ts turns into its frame. */
export function showGeneratedImages(markdown: string): string {
  if (!markdown.includes(PREFIX)) return markdown;
  return markdown.replace(
    PLACEHOLDER,
    (_whole, id: string) => loaded.get(id)?.url ?? STUB(id),
  );
}

/** The src of `markdown` when it is one picture's whole Markdown,
 *  `![alt](src)` - `<...>` around it taken off - else null. */
export function pictureSrc(markdown: string): string | null {
  const m = /^!\[[^\]]*\]\((<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\)$/.exec(
    markdown.trim(),
  );
  if (!m) return null;
  const src = m[1].startsWith("<") ? m[1].slice(1, -1) : m[1];
  return src || null;
}

/** Whether `markdown` holds a waiting picture. */
export function hasGeneratedImage(markdown: string): boolean {
  return markdown.includes(PREFIX);
}

/** The proposal's text with the picture's placeholder as its saved src. */
export function withSavedSrc(text: string, id: string, src: string): string {
  // The src may need <...> around it: a path with spaces or parentheses.
  const safe = /[\s()<>]/.test(src) ? `<${src}>` : src;
  return text.split(generatedImageSrc(id)).join(safe);
}

/** Where each accepted picture was saved. An undo brings its proposal
 *  back; accepted again, it writes the same file's src instead of saving
 *  a second copy. */
const saved = new Map<string, string>();

export function savedSrc(id: string): string | undefined {
  return saved.get(id);
}

/** A picture is saved: the backend lets its copy go. The preview's copy
 *  stays, for an undo to show the proposal again. */
export function rememberSaved(id: string, src: string): void {
  saved.set(id, src);
  void ai.discardGeneratedImage(id).catch(() => {});
}

/** Lets a picture go everywhere: its proposal was rejected. */
export function discardGeneratedImage(id: string): void {
  if (saved.has(id)) return;
  loaded.delete(id);
  void ai.discardGeneratedImage(id).catch(() => {});
}

/** `text` with `picture` (its Markdown) put next to the paragraph that
 *  quotes `anchor` - after it, or before it - on a line of its own; null
 *  when `anchor` isn't in `text` exactly once. How a picture asked for
 *  next to text proposed and not decided yet joins that proposal. */
export function joinedText(
  text: string,
  anchor: string,
  action: "insert_after" | "insert_before",
  picture: string,
): string | null {
  const at = text.indexOf(anchor);
  if (at < 0 || text.indexOf(anchor, at + 1) >= 0) return null;
  if (action === "insert_after") {
    const end = text.indexOf("\n\n", at + anchor.length);
    if (end < 0) return `${text}\n\n${picture}`;
    return `${text.slice(0, end)}\n\n${picture}${text.slice(end)}`;
  }
  const start = text.lastIndexOf("\n\n", at);
  if (start < 0) return `${picture}\n\n${text}`;
  return `${text.slice(0, start)}\n\n${picture}${text.slice(start)}`;
}

/** A generate_image call's `in_text` picture as its slot (EditProposal.
 *  slot): where the text it is for is going - at the caret, or the end of
 *  the document - until that text takes it in; null for any other call. */
export function pictureSlot(
  argumentsJson: string,
  cursor: number | null,
): EditProposal | null {
  try {
    const parsed = JSON.parse(argumentsJson);
    const image = parsed.image;
    if (parsed.action !== "in_text" || !image || typeof image.id !== "string")
      return null;
    const width = Number(image.width) || 0;
    const height = Number(image.height) || 0;
    sizes.set(image.id, { width, height });
    const alt = cleanAlt(typeof parsed.alt === "string" ? parsed.alt : "");
    return {
      action: cursor === null ? "append" : "insert_at_cursor",
      text: `![${alt}](${generatedImageSrc(image.id)})`,
      image: { id: image.id, alt, width, height, pending: true },
      slot: true,
    };
  } catch {
    return null;
  }
}
