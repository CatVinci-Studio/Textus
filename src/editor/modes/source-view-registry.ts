import type { EditorView } from "@codemirror/view";

/**
 * The source editor in a subtree. CodeMirror itself loads with source mode,
 * so this module holds only a map: app code that places the caret needn't
 * import the editor at startup. `SourceEditor` registers on mount.
 */
const views = new WeakMap<HTMLElement, SourceView>();

/** What the Edit menu asks of the editor that has the keyboard. */
export type SourceEdit = "undo" | "redo" | "select-all";

export interface SourceView {
  host: HTMLElement;
  view: EditorView;
  /** Its own Undo, Redo and Select All: the system's do nothing in a
   *  CodeMirror document off macOS. */
  edit: (action: SourceEdit) => void;
}

export function registerSourceView(
  host: HTMLElement,
  view: EditorView,
  edit: (action: SourceEdit) => void,
): void {
  views.set(host, { host, view, edit });
}

export function unregisterSourceView(host: HTMLElement): void {
  views.delete(host);
}

/** The active tab's source editor, if source mode or split view is showing. */
export function sourceViewAt(root: ParentNode = document): SourceView | null {
  const host = root.querySelector<HTMLElement>(".source-view");
  return (host && views.get(host)) ?? null;
}
