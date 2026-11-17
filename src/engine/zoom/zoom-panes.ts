import type { EditorView } from "@codemirror/view";

/**
 * Where a tab's document scrolls, told by each editor as it mounts: what a
 * zoom step holds still under the pointer. A tab in split view has two.
 */
export type ZoomPane =
  | {
      kind: "rendered";
      scroller: HTMLElement;
      /** The zoomed column, once the editor has drawn it. */
      content: () => Element | null;
    }
  | { kind: "source"; scroller: HTMLElement; view: EditorView };

const panes = new Map<string, Set<ZoomPane>>();

/** Adds `pane` to `tabId`'s; returns the take-back. */
export function registerZoomPane(tabId: string, pane: ZoomPane): () => void {
  let own = panes.get(tabId);
  if (!own) panes.set(tabId, (own = new Set()));
  own.add(pane);
  return () => {
    own.delete(pane);
    if (!own.size && panes.get(tabId) === own) panes.delete(tabId);
  };
}

/** `tabId`'s panes, in the order they mounted; none when it shows no
 *  document. */
export function zoomPanesOf(tabId: string): ZoomPane[] {
  return [...(panes.get(tabId) ?? [])];
}
