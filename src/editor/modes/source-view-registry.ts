import type { EditorView } from "@codemirror/view";

/**
 * The source editor in a subtree. CodeMirror itself loads with source mode,
 * so this module holds only a map: app code that places the caret needn't
 * import the editor at startup. `SourceEditor` registers on mount.
 */
const views = new WeakMap<HTMLElement, EditorView>();

export interface SourceView {
  host: HTMLElement;
  view: EditorView;
}

export function registerSourceView(host: HTMLElement, view: EditorView): void {
  views.set(host, view);
}

export function unregisterSourceView(host: HTMLElement): void {
  views.delete(host);
}

/** The active tab's source editor, if source mode or split view is showing. */
export function sourceViewAt(root: ParentNode = document): SourceView | null {
  const host = root.querySelector<HTMLElement>(".source-view");
  const view = host ? views.get(host) : undefined;
  return host && view ? { host, view } : null;
}
