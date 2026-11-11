import { tabInUse } from "../engine/layout/store";

/** Whether `dom` (an editor's, rich or source) is the one in use: the
 *  focused editor, else the one of the tab in use; a hidden one never is. */
export function editorInUse(dom: HTMLElement): boolean {
  if (dom.offsetParent === null) return false;
  const focused = document.activeElement?.closest(".ProseMirror, .cm-editor");
  if (focused) return focused === dom;
  return (
    dom.closest<HTMLElement>("[data-tab-id]")?.dataset.tabId === tabInUse()
  );
}
