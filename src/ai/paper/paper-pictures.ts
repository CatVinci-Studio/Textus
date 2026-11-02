import type { Ctx } from "@milkdown/kit/ctx";
import type { EditorView } from "@milkdown/kit/prose/view";
import { replaceWithMarkdown } from "../revision/apply-edit";

/** One of a finished paper's pictures: its id in the picture store, its alt
 *  text, and the caption under it, which says where it goes. */
export interface PaperPicture {
  id: string;
  alt: string;
  caption: string;
}

const PICTURE =
  /^\s*!\[([^\]\n]*)\]\(textus-generated:([0-9a-z]+)[^)\n]*\)\s*$/;
const CAPTION = /^\s*\*(.+)\*\s*$/;

/** The pictures of the finished paper `markdown`, in reading order, each
 *  with its numbered caption; one without a caption has no place to go. */
export function paperPictures(markdown: string): PaperPicture[] {
  const lines = markdown.split("\n");
  const out: PaperPicture[] = [];
  lines.forEach((line, i) => {
    const picture = PICTURE.exec(line);
    if (!picture) return;
    const next = lines.slice(i + 1).find((l) => l.trim() !== "");
    const caption = next && CAPTION.exec(next);
    if (caption)
      out.push({ alt: picture[1], id: picture[2], caption: caption[1].trim() });
  });
  return out;
}

/** The markdown of a saved picture: its src in <…> when it would break the
 *  link otherwise. */
function pictureLine(alt: string, src: string): string {
  return `![${alt}](${/[\s()<>]/.test(src) ? `<${src}>` : src})`;
}

/**
 * Puts the saved picture `src` above its caption, where the paper planned
 * it, as a step of its own. False when the caption is gone: the user has
 * changed that part since, and the picture is left out.
 */
export function placePicture(
  view: EditorView,
  ctx: Ctx,
  picture: PaperPicture,
  src: string,
): boolean {
  let at: number | null = null;
  view.state.doc.forEach((node, pos) => {
    if (node.type.name === "paragraph" && node.textContent === picture.caption)
      at = pos;
  });
  if (at === null) return false;
  const tr = replaceWithMarkdown(
    view.state.tr,
    ctx,
    at,
    at,
    pictureLine(picture.alt, src),
  );
  view.dispatch(tr);
  return true;
}
