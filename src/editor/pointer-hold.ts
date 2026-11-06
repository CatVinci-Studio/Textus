import { isReadOnly } from "./read-only-plugin";
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";

/** Where the selection was when the mouse button went down, mapped through
 *  edits since; null while no button is held. */
type Held = { from: number; to: number } | null;

const pointerHoldKey = new PluginKey<Held>("pointer-hold");

/**
 * The selection the plugins that show source under the caret (a span's `**`,
 * a heading's `#`) draw for: while the mouse button is held on the page, where
 * it was when the button went down. Their marks coming and going under the
 * pointer made the web view start a drag selection over at each one, so a
 * drag from bold text or a heading selected nothing; they catch up once the
 * button is let go.
 */
export function revealSelection(state: EditorState): {
  from: number;
  to: number;
} {
  // Read-only, as in the split view's preview, nothing shows as source: the
  // caret can't change it, so `###` or `**` would only be in the way.
  if (noRevealKey.getState(state) || isReadOnly(state)) return NOWHERE;
  return pointerHoldKey.getState(state) ?? state.selection;
}

const noRevealKey = new PluginKey<boolean>("no-reveal");
// Before every position, so no range is ever touched.
const NOWHERE = { from: -2, to: -2 };

/** A view that is only read (the split view's preview): every syntax drawn,
 *  none shown as source wherever its selection lands. */
export const noRevealPlugin = $prose(
  () =>
    new Plugin<boolean>({
      key: noRevealKey,
      state: { init: () => true, apply: (_tr, on) => on },
    }),
);

/** Whether what was drawn for `before`'s selection is stale in `after`. */
export function revealMoved(before: EditorState, after: EditorState): boolean {
  const a = revealSelection(before);
  const b = revealSelection(after);
  return a.from !== b.from || a.to !== b.to;
}

/** What ends a press: the button let go, a drag of the selected text over
 *  (no mouseup follows one), or - when a mouseup outside the window went
 *  unseen - the button found up as the mouse moves, or a key typed. */
const RELEASES = ["mouseup", "dragend", "mousemove", "keydown"] as const;

/** Held down through a drag to change what it does, so they end nothing. */
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);

function stillHeld(event: Event): boolean {
  // Another button's mouseup mid-drag leaves the left one down.
  if (
    event instanceof MouseEvent &&
    (event.type === "mousemove" || event.button !== 0)
  )
    return (event.buttons & 1) === 1;
  return event instanceof KeyboardEvent && MODIFIERS.has(event.key);
}

export const pointerHoldPlugin = $prose(
  () =>
    new Plugin<Held>({
      key: pointerHoldKey,
      state: {
        init: () => null,
        apply(tr, held) {
          const set = tr.getMeta(pointerHoldKey) as Held | undefined;
          if (set !== undefined) return set;
          if (!held || !tr.docChanged) return held;
          return {
            from: tr.mapping.map(held.from),
            to: tr.mapping.map(held.to),
          };
        },
      },
      view(view) {
        const page =
          view.dom.closest<HTMLElement>(".editor-scroll") ?? view.dom;
        const listen = (on: boolean) => {
          const method = on ? "addEventListener" : "removeEventListener";
          for (const type of RELEASES) window[method](type, release, true);
        };
        const release = (event: Event) => {
          if (stillHeld(event)) return;
          listen(false);
          if (!view.isDestroyed && pointerHoldKey.getState(view.state))
            view.dispatch(view.state.tr.setMeta(pointerHoldKey, null));
        };
        const press = (event: MouseEvent) => {
          if (event.button !== 0) return;
          const { from, to } = view.state.selection;
          view.dispatch(view.state.tr.setMeta(pointerHoldKey, { from, to }));
          listen(true);
        };
        // Captured, so the button is held before anything moves the
        // selection.
        page.addEventListener("mousedown", press, true);
        return {
          destroy() {
            listen(false);
            page.removeEventListener("mousedown", press, true);
          },
        };
      },
    }),
);
