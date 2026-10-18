import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";

/**
 * Transaction meta for an edit made by pointing at something rather than
 * typing at the caret - ticking a task's box (task-list-plugin.ts). It
 * leaves the caret where it was, so recentring on it would scroll the view
 * away from what was just clicked (#136).
 */
export const TYPEWRITER_HOLD = "typewriterHold";

const typewriterKey = new PluginKey<boolean>("typewriter");

/**
 * Typora/iA Writer-style typewriter scrolling: keeps the cursor's line
 * pinned near vertical center of the scroll container instead of letting it
 * drift to the bottom as you type. Requires `.editor-content` to have
 * enough top/bottom padding for the first/last lines to actually reach
 * center (see `.typewriter-active` in app/editor-column.css).
 */
export function createTypewriterPlugin(options: { enabled: () => boolean }) {
  return $prose(
    () =>
      new Plugin<boolean>({
        key: typewriterKey,
        state: {
          init: () => false,
          apply: (tr) => tr.getMeta(TYPEWRITER_HOLD) === true,
        },
        view(editorView) {
          // Centres the caret line's MIDDLE (not its top, which sat half a
          // line high) in the scroll container.
          const center = (view: typeof editorView) => {
            const scrollContainer = view.dom.closest(".editor-scroll");
            if (!scrollContainer || view.dom.offsetParent === null) return;
            const coords = view.coordsAtPos(view.state.selection.head);
            const containerRect = scrollContainer.getBoundingClientRect();
            const targetY = containerRect.top + containerRect.height / 2;
            const delta = (coords.top + coords.bottom) / 2 - targetY;
            if (Math.abs(delta) > 2) scrollContainer.scrollTop += delta;
          };
          let wasEnabled = options.enabled();
          // A resized window moves the middle; turning the mode on centres
          // straight away instead of waiting for the next keystroke.
          const onResize = () => {
            if (options.enabled() && !editorView.composing) center(editorView);
          };
          window.addEventListener("resize", onResize);
          return {
            update(view, prevState) {
              const enabled = options.enabled();
              const justEnabled = enabled && !wasEnabled;
              wasEnabled = enabled;
              if (!enabled) return;
              if (view.composing) return;
              if (typewriterKey.getState(view.state)) return;
              if (
                !justEnabled &&
                view.state.doc.eq(prevState.doc) &&
                view.state.selection.eq(prevState.selection)
              )
                return;
              center(view);
            },
            destroy() {
              window.removeEventListener("resize", onResize);
            },
          };
        },
      }),
  );
}
