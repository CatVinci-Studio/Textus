import { $prose } from "@milkdown/kit/utils";
import { Plugin } from "@milkdown/kit/prose/state";
import { KEYBOARD_UP_EVENT } from "../utils/events";

/** How long the page takes to settle over the keyboard. */
const SETTLE_MS = 250;

/**
 * The keyboard come up under a tap brings the caret's line into view again
 * once the page has its new height: the web view's own scroll counts the
 * keyboard, not the format bar riding on it (editor-scroll.ts does).
 */
export const keyboardCaretPlugin = $prose(
  () =>
    new Plugin({
      view(view) {
        let timer = 0;
        const risen = () => {
          clearTimeout(timer);
          timer = window.setTimeout(() => {
            if (view.hasFocus()) view.dispatch(view.state.tr.scrollIntoView());
          }, SETTLE_MS);
        };
        window.addEventListener(KEYBOARD_UP_EVENT, risen);
        return {
          destroy() {
            window.removeEventListener(KEYBOARD_UP_EVENT, risen);
            clearTimeout(timer);
          },
        };
      },
    }),
);
