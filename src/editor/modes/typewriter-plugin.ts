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
          // A caret or selection placed with the mouse or a finger stays
          // where it was put, as in Typora; the next key centres it.
          // Centring while the button was down scrolled the text under the
          // still pointer, the browser extended the selection to where the
          // pointer now was, and that centred again - a click landed on
          // another paragraph and a drag ran away (#217). Centring once on
          // release would still pull the text from under a double click's
          // second press. Set by a press in the document, cleared by any
          // key or a press anywhere else (the find bar, the outline), which
          // move the caret for the user.
          let pointerPlaced = false;
          const onPointerDown = (event: PointerEvent) => {
            pointerPlaced =
              event.target instanceof Node &&
              editorView.dom.contains(event.target);
          };
          const onKey = () => {
            pointerPlaced = false;
          };
          window.addEventListener("pointerdown", onPointerDown, true);
          window.addEventListener("keydown", onKey, true);
          // A phone's keyboard may type without a usable keydown.
          editorView.dom.addEventListener("beforeinput", onKey);
          return {
            update(view, prevState) {
              const enabled = options.enabled();
              const justEnabled = enabled && !wasEnabled;
              wasEnabled = enabled;
              if (!enabled) return;
              if (view.composing) return;
              if (typewriterKey.getState(view.state)) return;
              if (!justEnabled && view.state.doc.eq(prevState.doc)) {
                if (view.state.selection.eq(prevState.selection)) return;
                if (pointerPlaced) return;
              }
              center(view);
            },
            destroy() {
              window.removeEventListener("resize", onResize);
              window.removeEventListener("pointerdown", onPointerDown, true);
              window.removeEventListener("keydown", onKey, true);
              editorView.dom.removeEventListener("beforeinput", onKey);
            },
          };
        },
      }),
  );
}
