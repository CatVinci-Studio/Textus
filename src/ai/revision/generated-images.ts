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
      },
    };
  } catch {
    return null;
  }
}

const loaded = new Map<string, GeneratedImageData & { url: string }>();
const loading = new Map<string, Promise<boolean>>();

/** Fetches a waiting picture from the backend once, so the preview can
 *  draw it at once; false when it is gone (the backend keeps the newest
 *  16, and nothing across a restart). */
export function loadGeneratedImage(id: string): Promise<boolean> {
  if (loaded.has(id)) return Promise.resolve(true);
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
      .catch(() => false)
      .finally(() => loading.delete(id));
    loading.set(id, pending);
  }
  return pending;
}

/** A loaded picture's bytes, for saving it. */
export function generatedImageData(id: string): GeneratedImageData | null {
  return loaded.get(id) ?? null;
}

/** Markdown for the preview: each waiting picture's placeholder src as
 *  its data: URL. One not loaded keeps the placeholder (and shows as a
 *  missing image). */
export function showGeneratedImages(markdown: string): string {
  if (!markdown.includes(PREFIX)) return markdown;
  return markdown.replace(
    PLACEHOLDER,
    (whole, id: string) => loaded.get(id)?.url ?? whole,
  );
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
