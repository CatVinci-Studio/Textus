import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";

/**
 * Transaction meta for an edit made by pointing rather than typing (ticking
 * a task's box): it leaves the caret, so recentring would scroll away.
 */
export const TYPEWRITER_HOLD = "typewriterHold";

const typewriterKey = new PluginKey<boolean>("typewriter");

/**
 * Typewriter scrolling: keeps the cursor's line near the vertical centre of
 * the scroll container. Needs enough content padding for the first and last
 * lines to reach it.
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
          // Centres the caret line's middle, not its top, which sat half a line high.
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
          // A caret placed with the mouse or a finger stays where it was put, as in
          // Typora; the next key centres it. Centring while the button was down
          // scrolled text under the pointer and a drag ran away. Cleared by any key
          // or a press outside the document.
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
