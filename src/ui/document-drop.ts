/**
 * Something dragged over the documents from elsewhere in the window - a
 * file from the sidebar's tree - and let go there. The window shell says
 * what that does (app/split-drop.ts: show where it would open, then open
 * it there); what is dragged only asks, so it needs to know nothing of
 * tabs or splits.
 */
export interface DocumentDrop {
  /** The pointer is at (x, y): shows where a drop would open; false when
   *  it isn't over the documents. */
  over(x: number, y: number): boolean;
  /** The drag left or was given up: nothing shown any more. */
  leave(): void;
  /** `path` let go at (x, y); false when that isn't over the documents. */
  drop(path: string, x: number, y: number): boolean;
}

let current: DocumentDrop | null = null;

/** The window's way to take a drop; null when it goes. */
export function setDocumentDrop(drop: DocumentDrop | null): void {
  current = drop;
}

export function documentDrop(): DocumentDrop | null {
  return current;
}
