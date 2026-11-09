/**
 * What the editor's menu can do to a block a plugin draws (a database, a
 * chart): open its source, or delete it whole. The drawing registers its
 * own; the menu finds them from the element right-clicked.
 */
export interface DrawnBlockActions {
  editSource(): void;
  remove(): void;
  /** Where its width and size can change: the pane's width, and the size
   *  its page draws at. */
  layout?: {
    wide: boolean;
    zoom: number;
    zooms: readonly number[];
    set(patch: { wide?: boolean; zoom?: number }): void;
  };
}

const actions = new WeakMap<Element, DrawnBlockActions>();

export function setDrawnBlockActions(
  el: Element,
  value: DrawnBlockActions,
): void {
  actions.set(el, value);
}

/** The actions of the drawing `target` is in, if any. */
export function drawnBlockActionsAt(
  target: EventTarget | null,
): DrawnBlockActions | null {
  let el = target instanceof Element ? target : null;
  for (; el; el = el.parentElement) {
    const found = actions.get(el);
    if (found) return found;
  }
  return null;
}
