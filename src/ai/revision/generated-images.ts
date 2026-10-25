import { ai, type GeneratedImageData } from "../../platform/ipc";
import { EDIT_ACTIONS, type EditAction, type EditProposal } from "../types";

/**
 * The pictures generate_image proposes (src-tauri ai/images.rs). The
 * picture waits in the backend, in memory, until Accept saves it the way
 * Settings › Images says; until then the proposal's Markdown names it by a
 * placeholder src, and only the preview in the document - never the
 * conversation, which is saved - holds its bytes, as a blob: URL.
 */

const PREFIX = "textus-generated:";

/** The src a waiting picture has in its proposal's text. */
export function generatedImageSrc(id: string): string {
  return `${PREFIX}${id}`;
}

/** A whole placeholder: its id up to the src's closing parenthesis - not
 *  the start of one a stream has typed only so far. */
const PLACEHOLDER = /textus-generated:([0-9a-z]+)(?=[)>\s"])/g;

/** A picture as a blob: URL - a few dozen characters standing for its
 *  bytes, decoded once - for the preview to draw it by. A data: URL put
 *  the whole picture, megabytes of base64, into the Markdown each frame
 *  of the typewriter parsed again and each <img> it made decoded again:
 *  the window stalled for seconds while a long text with pictures
 *  streamed in. */
function blobUrl(data: GeneratedImageData): string {
  const binary = atob(data.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: data.mime }));
}

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
    // Its frame's shape, wherever it is drawn - in a text it joins as
    // much as on its own.
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
      ...(typeof parsed.block === "string" && parsed.block
        ? { block: parsed.block }
        : {}),
      anchor,
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

/** The width and height `aspect` ("16:9") asks for, or null. */
function aspectSize(aspect: string): { width: number; height: number } | null {
  const m = /^(\d+):(\d+)$/.exec(aspect.trim());
  return m ? { width: Number(m[1]) * 100, height: Number(m[2]) * 100 } : null;
}

/** The stand-in id of a picture its call is still asking for. */
export function draftPictureId(callId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < callId.length; i++) {
    h ^= callId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `draft${h.toString(36)}`;
}

function isDraftPicture(id: string): boolean {
  return id.startsWith("draft");
}

/**
 * A generate_image call still streaming, as a proposal - its frame in its
 * place and shape the moment the call says where it goes and how wide it
 * is (fields in schema order: action, alt, anchor, aspect, context,
 * prompt), rather than once the whole description has come and the
 * picture is asked for (live_eval::latency, redo_a_picture: three seconds
 * of nothing on a ChatGPT subscription, more on Claude). The completed
 * call's proposal, with the picture's own id, takes its place.
 */
export function draftPictureProposal(
  callId: string,
  fields: Record<string, { value: string; complete: boolean }>,
): EditProposal | null {
  const action = fields.action;
  if (!action?.complete) return null;
  if (!EDIT_ACTIONS.includes(action.value as EditAction)) return null;
  const anchored = ["insert_after", "insert_before", "replace"].includes(
    action.value,
  );
  const anchor = fields.anchor;
  if (anchored && !(anchor?.complete && anchor.value)) return null;
  // Its shape: given, or past - the default, square.
  const aspect = fields.aspect;
  const shapeKnown = aspect?.complete || !!fields.prompt;
  if (!shapeKnown) return null;
  const id = draftPictureId(callId);
  const size = (aspect?.complete && aspectSize(aspect.value)) || {
    width: 1000,
    height: 1000,
  };
  sizes.set(id, size);
  const alt = cleanAlt(fields.alt?.complete ? fields.alt.value : "");
  return {
    action: action.value as EditAction,
    ...(fields.block?.complete ? { block: fields.block.value } : {}),
    anchor: anchored ? anchor!.value : undefined,
    text: `![${alt}](${generatedImageSrc(id)})`,
    image: { id, alt, ...size, pending: true },
  };
}

const loaded = new Map<string, GeneratedImageData & { url: string }>();
const loading = new Map<string, Promise<boolean>>();
/** Why a picture wasn't made, in the service's words. */
const failed = new Map<string, string>();
/** The size each picture was asked for: its frame's shape meanwhile. */
const sizes = new Map<string, { width: number; height: number }>();

/** Asks again for a picture that wasn't made, leaving the proposal's
 *  others alone; resolves as loadGeneratedImage does for the new try. */
export async function retryGeneratedImage(id: string): Promise<boolean> {
  try {
    await ai.retryGeneratedImage(id);
  } catch (err) {
    failed.set(id, err instanceof Error ? err.message : String(err));
    return false;
  }
  failed.delete(id);
  for (const listener of listeners) listener();
  return loadGeneratedImage(id);
}

/** The description picture `id` was drawn from, for the writer to change;
 *  null once the backend has let it go. */
export function generatedImagePrompt(id: string): Promise<string | null> {
  return ai.generatedImagePrompt(id).catch(() => null);
}

/** Draws a made (or not made) picture again from `prompt`, the writer's
 *  change to its description: its frame paints again, here and on its
 *  card, until the new one comes; resolves as loadGeneratedImage does. */
export async function redrawGeneratedImage(
  id: string,
  prompt: string,
): Promise<boolean> {
  try {
    await ai.redrawGeneratedImage(id, prompt);
  } catch (err) {
    failed.set(id, err instanceof Error ? err.message : String(err));
    for (const listener of listeners) listener();
    return false;
  }
  const url = loaded.get(id)?.url;
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
  loaded.delete(id);
  failed.delete(id);
  for (const listener of listeners) listener();
  return loadGeneratedImage(id);
}

/** The id of the loaded picture drawn by `src` (its blob: URL), or null. */
export function loadedImageId(src: string): string | null {
  for (const [id, data] of loaded) if (data.url === src) return id;
  return null;
}

/** Fetches a picture from the backend once - which answers when it is
 *  made, so a picture still painting waits here - for the preview to draw
 *  it; false when it wasn't made (generatedImageFailure says why) or is
 *  gone (the backend keeps the newest 16, and nothing across a restart). */
export function loadGeneratedImage(id: string): Promise<boolean> {
  // A streaming call's stand-in (draftPictureProposal): nothing to fetch,
  // it paints until the call's own picture takes its place.
  if (isDraftPicture(id)) return new Promise<boolean>(() => {});
  if (loaded.has(id)) return Promise.resolve(true);
  if (failed.has(id)) return Promise.resolve(false);
  let pending = loading.get(id);
  if (!pending) {
    pending = ai
      .generatedImage(id)
      .then((data) => {
        loaded.set(id, { ...data, url: blobUrl(data) });
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

/** A picture's shape as CSS aspect-ratio ("16 / 9"), for a frame drawn
 *  before it comes - in the card and the margin as in the document. */
export function generatedImageRatio(id: string): string | undefined {
  const size = sizes.get(id);
  return size && size.width > 0 && size.height > 0
    ? `${size.width} / ${size.height}`
    : undefined;
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

/** The src a waiting picture is drawn by in the preview: its blob: URL
 *  once loaded, else the stand-in framePendingPictures frames. */
export function shownGeneratedSrc(id: string): string {
  return loaded.get(id)?.url ?? STUB(id);
}

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
  const url = loaded.get(id)?.url;
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
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

/** The src of a picture the model writes into new text, on a line of its
 *  own, `![alt](textus-picture:16:9 what it shows)` - begun the moment the
 *  line has streamed in. Mirrors PICTURE_SCHEME in src-tauri
 *  ai/images/inline.rs. */
const PICTURE_LINE = "textus-picture:";

/** The picture begun for each picture line, by call: the backend says so
 *  (the `picture` stream event) before the line itself arrives. Only the
 *  latest calls are kept - a completed call's text names its pictures. */
const begun = new Map<string, Map<string, string>>();
const BEGUN_CALLS = 32;

/** A picture line of a streaming propose_edit stands for picture `id`. */
export function noteBegunPicture(
  callId: string,
  line: string,
  id: string,
  size: { width: number; height: number },
): void {
  sizes.set(id, size);
  let lines = begun.get(callId);
  if (!lines) {
    lines = new Map();
    begun.set(callId, lines);
    for (const old of begun.keys()) {
      if (begun.size <= BEGUN_CALLS) break;
      begun.delete(old);
    }
  }
  lines.set(line, id);
}

/** A streaming propose_edit's text as far as it has come, each picture
 *  line as its picture - a frame until it comes. A line no picture was
 *  begun for, or one still being written, is left out: never shown as
 *  text. */
export function withBegunPictures(callId: string, text: string): string {
  if (!text.includes("!")) return text;
  const ids = begun.get(callId);
  const lines = text.split("\n");
  return lines
    .flatMap((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("![") && trimmed.includes(`](${PICTURE_LINE}`)) {
        const id = ids?.get(trimmed);
        if (!id) return [];
        const alt = cleanAlt(trimmed.slice(2, trimmed.indexOf("](")));
        return [`![${alt}](${generatedImageSrc(id)})`];
      }
      // The last line may be a picture line still being written.
      const last = i === lines.length - 1;
      if (last && trimmed.startsWith("!") && !trimmed.endsWith(")")) return [];
      return [line];
    })
    .join("\n");
}
