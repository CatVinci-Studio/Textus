import { tabInUse } from "../engine/layout/store";

/** Whether `dom` (an editor's, rich or source) is the one in use: the
 *  focused editor, else the one of the tab in use; a hidden one never is. */
export function editorInUse(dom: HTMLElement): boolean {
  if (dom.offsetParent === null) return false;
  let focused = document.activeElement?.closest(".ProseMirror, .cm-editor");
  // A split's preview is its source's: keys pressed there mean the source.
  if (focused?.closest(".split-preview"))
    focused =
      focused.closest(".split-view")?.querySelector(".cm-editor") ?? focused;
  if (focused) return focused === dom;
  return (
    dom.closest<HTMLElement>("[data-tab-id]")?.dataset.tabId === tabInUse()
  );
}
