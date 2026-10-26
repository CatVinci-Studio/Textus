/**
 * Blocks the document draws by someone else's code - a plugin's code block
 * (document-view/plugins/plugin-code-blocks.ts) - which only their drawer
 * can turn into a picture. The window shell says how (setDrawnBlocks); an
 * export asks, and puts the pictures where the drawings were. A block with
 * no picture exports as its source, as it would with no drawer at all.
 */
export interface DrawnBlocks {
  /** The drawings' elements in the editor, each just after its source. */
  selector: string;
  /** The class that hides a source while its drawing shows. */
  hiddenSource: string;
  /** The language a drawing's block is in. */
  language(el: HTMLElement): string;
  /** A picture of the drawing for a page of `theme`: an SVG's markup or
   *  an image's data: URL, null when there is none. */
  picture(el: HTMLElement, theme: "light" | "dark"): Promise<string | null>;
}

let current: DrawnBlocks | null = null;

export function setDrawnBlocks(blocks: DrawnBlocks | null): void {
  current = blocks;
}

/** Marks a drawing's picture on it for the copy an export makes. */
const PICTURE_ATTR = "data-export-picture";

/** `text` as an image URL, or null when it is neither SVG nor an image. */
export function pictureUrl(text: string | null): string | null {
  if (!text) return null;
  if (/^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/.test(text)) return text;
  const svg = text.trim();
  if (!/^(<\?xml[^>]*>\s*)?<svg[\s>]/.test(svg)) return null;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/** The drawings under `editor`, each with its picture (null for none), in
 *  the document's order. */
async function pictures(
  editor: Element,
  theme: "light" | "dark",
): Promise<{ el: HTMLElement; url: string | null }[]> {
  const blocks = current;
  if (!blocks) return [];
  const els = Array.from(editor.querySelectorAll<HTMLElement>(blocks.selector));
  return Promise.all(
    els.map(async (el) => ({
      el,
      url: pictureUrl(await blocks.picture(el, theme).catch(() => null)),
    })),
  );
}

/**
 * Asks every drawing under the live `editor` for its picture and marks it
 * there, for cloneEditorContent to place (placeDrawnPictures). Returns
 * what takes the marks off again, once the copy is made.
 */
export async function markDrawnPictures(
  editor: Element,
  theme: "light" | "dark",
): Promise<() => void> {
  const found = await pictures(editor, theme);
  for (const { el, url } of found) if (url) el.setAttribute(PICTURE_ATTR, url);
  return () => found.forEach(({ el }) => el.removeAttribute(PICTURE_ATTR));
}

/** In an export's copy of the editor: each drawing becomes its picture, or
 *  goes and leaves its source showing. */
export function placeDrawnPictures(clone: Element): void {
  const blocks = current;
  if (!blocks) return;
  clone.querySelectorAll<HTMLElement>(blocks.selector).forEach((el) => {
    const url = el.getAttribute(PICTURE_ATTR);
    if (url) {
      const img = document.createElement("img");
      img.className = "drawn-block-picture";
      img.alt = "";
      img.src = url;
      el.replaceWith(img);
    } else {
      el.previousElementSibling?.classList.remove(blocks.hiddenSource);
      el.remove();
    }
  });
}

/** The pictures of the drawings under `editor` by language, in the
 *  document's order: the n-th ```lang block's is the n-th of its list. */
export async function drawnPicturesByLanguage(
  editor: Element,
  theme: "light" | "dark",
): Promise<Map<string, (string | null)[]>> {
  const out = new Map<string, (string | null)[]>();
  const blocks = current;
  if (!blocks) return out;
  for (const { el, url } of await pictures(editor, theme)) {
    const language = blocks.language(el);
    out.set(language, [...(out.get(language) ?? []), url]);
  }
  return out;
}
