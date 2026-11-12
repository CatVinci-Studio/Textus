import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/** How long the system's keyboard takes to rise: the caret is shown again
 *  once it is up. */
const KEYBOARD_RISE_MS = 350;

/** Room kept between the caret's line and the bottom of what shows. */
const MARGIN = 12;

/** Scrolls `view`'s caret up into view if the container's bottom has come
 *  down over it. Never down, never centred. */
function revealCaret(view: EditorView) {
  const container = view.dom.closest(".editor-scroll");
  if (!container || view.dom.offsetParent === null) return;
  let coords: { bottom: number };
  try {
    coords = view.coordsAtPos(view.state.selection.head);
  } catch {
    return;
  }
  const bottom = container.getBoundingClientRect().bottom - MARGIN;
  if (coords.bottom > bottom) container.scrollTop += coords.bottom - bottom;
}

/**
 * On a phone the keyboard shortens the web view after the tap, and WebKit's
 * own scroll-to-caret is turned off (it carried the whole page off the top),
 * so a shrinking window brings the caret back: at the resize and after the
 * keyboard's animation.
 */
export const keyboardRevealPlugin = $prose(
  () =>
    new Plugin({
      view(editorView) {
        let height = window.innerHeight;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onResize = () => {
          const shorter = window.innerHeight < height;
          height = window.innerHeight;
          if (!shorter || !editorView.hasFocus() || editorView.composing)
            return;
          requestAnimationFrame(() => revealCaret(editorView));
          clearTimeout(timer);
          timer = setTimeout(() => revealCaret(editorView), KEYBOARD_RISE_MS);
        };
        window.addEventListener("resize", onResize);
        return {
          destroy() {
            clearTimeout(timer);
            window.removeEventListener("resize", onResize);
          },
        };
      },
    }),
);
