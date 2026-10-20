import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { isLargeDoc } from "./large-doc";

/** On the editor of a large document: its top-level blocks remember the
 *  size they were laid out at (milkdown-theme.css). */
export const LARGE_DOC_CLASS = "large-doc";
/** And once they have: those off screen skip layout and paint. */
export const SKIP_OFFSCREEN_CLASS = "skip-offscreen";

const key = new PluginKey<boolean>("content-visibility");

/**
 * Marks a large document's editor for `content-visibility: auto` on its
 * top-level blocks (milkdown-theme.css): the browser keeps every block in
 * the DOM - selection, find, input methods and the accessibility tree see
 * all of it - but lays out and paints only those near the screen. Without
 * it a new block (Enter) laid out all of a long document again.
 *
 * Not from the first frame: a block skipped before it was ever laid out
 * stands in at a guessed height, and the guesses corrected as the reader
 * scrolled moved the text under them - an outline jump landed, then slid.
 * The document is laid out whole once as it opens (as it always was), each
 * block remembering its height (contain-intrinsic-size: auto), and only
 * then are the blocks off screen skipped, at the heights they really have.
 *
 * Only large documents: the containment it brings scopes margins and
 * counters to each block, a risk a short document has no reason to take.
 * And only in Chromium (WebView2 on Windows): WebKit has it too, but there
 * it made edits slower, not faster - in a 5k-block document Enter's layout
 * went from 23 to 178 ms in WebKitGTK 2.54, and Playwright's WebKit took a
 * keystroke from 16 to 93 ms - so WebKitGTK and WKWebView keep laying out
 * the whole document, as they always have.
 */
const engineGains =
  typeof navigator !== "undefined" && /\bChrome\//.test(navigator.userAgent);
export const contentVisibilityPlugin = $prose(
  () =>
    new Plugin<boolean>({
      key,
      state: {
        init: () => false,
        apply: (tr, skip) => skip || tr.getMeta(key) === true,
      },
      props: {
        attributes: (state): Record<string, string> => {
          if (!engineGains || !isLargeDoc(state.doc)) return {};
          return {
            class: key.getState(state)
              ? `${LARGE_DOC_CLASS} ${SKIP_OFFSCREEN_CLASS}`
              : LARGE_DOC_CLASS,
          };
        },
      },
      view(view) {
        let frame = 0;
        let waiting = false;
        // Two frames: one to lay the blocks out, one for the browser to
        // have noted their sizes.
        const skip = () => {
          frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => {
              if (view.isDestroyed) return;
              view.dispatch(
                view.state.tr.setMeta(key, true).setMeta("addToHistory", false),
              );
            });
          });
        };
        // A tab opened in the back (display: none) has no sizes to note
        // until it is shown.
        const shown =
          typeof ResizeObserver === "undefined"
            ? null
            : new ResizeObserver(() => {
                if (!view.dom.clientWidth) return;
                shown?.disconnect();
                skip();
              });
        const start = () => {
          if (waiting || key.getState(view.state)) return;
          if (!engineGains || !isLargeDoc(view.state.doc)) return;
          waiting = true;
          if (view.dom.clientWidth || !shown) skip();
          else shown.observe(view.dom);
        };
        start();
        return {
          // A document grown large while open (a paste).
          update: start,
          destroy: () => {
            cancelAnimationFrame(frame);
            shown?.disconnect();
          },
        };
      },
    }),
);
