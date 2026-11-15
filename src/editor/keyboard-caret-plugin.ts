import { $prose } from "@milkdown/kit/utils";
import { Plugin } from "@milkdown/kit/prose/state";
import { KEYBOARD_UP_EVENT } from "../utils/events";

/** How long the page takes to settle over the keyboard. */
const SETTLE_MS = 250;

/**
 * The keyboard come up under a tap brings the caret's line into view again
 * once the page has its new height, and so does the page shrinking further
 * while it is up (a suggestion bar): the web view's own scroll counts the
 * keyboard, not the format bar riding on it (editor-scroll.ts does).
 */
export const keyboardCaretPlugin = $prose(
  () =>
    new Plugin({
      view(view) {
        let timer = 0;
        let height = window.innerHeight;
        const risen = () => {
          clearTimeout(timer);
          timer = window.setTimeout(() => {
            if (view.hasFocus() && !view.composing)
              view.dispatch(view.state.tr.scrollIntoView());
          }, SETTLE_MS);
        };
        const resized = () => {
          const shorter = window.innerHeight < height;
          height = window.innerHeight;
          // The root's mark, set by the app as the keyboard comes and goes.
          const up = document.documentElement.classList.contains("keyboard-up");
          if (shorter && up) risen();
        };
        window.addEventListener(KEYBOARD_UP_EVENT, risen);
        window.addEventListener("resize", resized);
        return {
          destroy() {
            window.removeEventListener(KEYBOARD_UP_EVENT, risen);
            window.removeEventListener("resize", resized);
            clearTimeout(timer);
          },
        };
      },
    }),
);
