import type { Fragment } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import { closeHistory } from "@milkdown/kit/prose/history";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { FileDropTarget } from "../../engine/controls/document-drop";
import { pulledLanding, showPulled } from "../blocks/block-handles-plugin";
import { fileImage, reportFailure, storeImageAs } from "../images/image-store";
import type { ImageStore } from "../images/image-store";
import { linkSource } from "../markdown/link-syntax";

/** An editor that takes dropped files: where its pictures are stored, and
 *  how it reads Markdown into its own content. */
interface DropEditor {
  store: ImageStore;
  parse: (markdown: string) => Fragment | null;
}

export const dropEditors = new Map<EditorView, DropEditor>();

/** A picture stored as a pasted one is, as the Markdown to put in. */
async function storeImage(path: string, store: ImageStore) {
  try {
    const stored = await storeImageAs(fileImage(path), store);
    if (!stored) return null;
    return stored.embed ?? `!${linkSource("", stored.src)}`;
  } catch (err) {
    reportFailure(err, store);
    return null;
  }
}

export function targetOf(view: EditorView): FileDropTarget | null {
  const editor = dropEditors.get(view);
  if (!editor) return null;
  const { store } = editor;
  return {
    docPath: store.docPath(),
    imageFolder: store.settings().imageFolder,
    storeImage: (path) => storeImage(path, store),
  };
}

/**
 * What `produce` gives for the files dropped on `view` put in where their
 * rooms stand - moved with any edit made while they were copied - as
 * blocks of their own, in one undo step; the caret after them.
 */
export async function fillRooms(
  view: EditorView,
  produce: (target: FileDropTarget) => Promise<string[]>,
): Promise<void> {
  const target = targetOf(view);
  const markdown = target ? await produce(target).catch(() => []) : [];
  if (view.isDestroyed) return;
  const landing = pulledLanding(view);
  showPulled(view, null);
  const content =
    markdown.length > 0
      ? dropEditors.get(view)?.parse(markdown.join("\n\n"))
      : null;
  if (landing === null || !content?.size) return;
  const tr = view.state.tr.insert(landing, content);
  const end = landing + content.size;
  tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1));
  view.dispatch(closeHistory(tr).scrollIntoView());
  view.focus();
}

/** `view` takes dropped files until it goes. */
export function takeDropsIn(view: EditorView, editor: DropEditor): () => void {
  dropEditors.set(view, editor);
  return () => dropEditors.delete(view);
}
