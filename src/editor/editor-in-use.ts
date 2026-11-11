import { splitLayout } from "../engine/layout/store";

/** Whether `dom` (an editor's) is the one in use: the focused editor, else
 *  the one in the island in use; a hidden one never is. */
export function editorInUse(dom: HTMLElement): boolean {
  if (dom.offsetParent === null) return false;
  const focused = document.activeElement?.closest(".ProseMirror");
  if (focused) return focused === dom;
  const focus = splitLayout()?.focus;
  if (!focus) return true;
  return dom.closest<HTMLElement>(".split-pane")?.dataset.paneId === focus;
}
