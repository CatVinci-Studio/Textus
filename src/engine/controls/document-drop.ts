/** A file dragged over the documents: from the sidebar, or from the system
 *  (`fromSystem`: a file manager), which is copied in before it is linked. */
export interface DraggedFile {
  path: string;
  isDir: boolean;
  fromSystem?: boolean;
}

/** Files dragged over the documents from elsewhere and let go there. The
 *  window shell decides what that does, so what is dragged needs to know
 *  nothing of tabs, splits or editors. */
export interface DocumentDrop {
  /** The pointer is at (x, y): shows what a drop there would do; false
   *  when it isn't over the documents. `shift`: Shift is held, which
   *  always opens. */
  over(
    files: readonly DraggedFile[],
    x: number,
    y: number,
    shift: boolean,
  ): boolean;
  /** The drag left or was given up: nothing shown any more. */
  leave(): void;
  /** `files` let go at (x, y): put in the document there, or opened;
   *  false when that isn't over the documents. */
  drop(
    files: readonly DraggedFile[],
    x: number,
    y: number,
    shift: boolean,
  ): boolean;
}

let current: DocumentDrop | null = null;

/** The window's way to take a drop; null when it goes. */
export function setDocumentDrop(drop: DocumentDrop | null): void {
  current = drop;
}

export function documentDrop(): DocumentDrop | null {
  return current;
}

/** What a file dropped between a document's blocks becomes: a picture, at
 *  its size when known (null: not yet, or never - an SVG), or a line with
 *  a link. `hint` says so inside the room it opens. */
export type FileRoom =
  | {
      kind: "image";
      size: { width: number; height: number } | null;
      hint: string;
    }
  | { kind: "link"; hint: string };

/** The document under a drop, as the shell needs it to write what goes in. */
export interface FileDropTarget {
  docPath: string | null;
  /** Settings › Images › Folder, where a dropped file is copied to. */
  imageFolder: string;
  /** A picture from the system stored as the editor stores a pasted one
   *  (Settings › Images); the Markdown to put in, or null. */
  storeImage(path: string): Promise<string | null>;
}

/** The editors' side of a drop: room opened between blocks where the files
 *  will go, and what they become put in there. Set by the editor, so the
 *  shell takes drops without loading it. */
export interface FileRooms {
  /** The document of tab `tabId`, if it shows in an editable editor. */
  targetIn(tabId: string): FileDropTarget | null;
  /** `rooms` opened between the blocks of tab `tabId`'s document nearest
   *  (x, y); false when it isn't in an editable editor. */
  show(
    tabId: string,
    x: number,
    y: number,
    rooms: readonly FileRoom[],
  ): boolean;
  clear(): void;
  /** The Markdown `produce` gives put in where the rooms stand, in one undo
   *  step; the rooms hold the place meanwhile. False when none is open. */
  fill(produce: (target: FileDropTarget) => Promise<string[]>): boolean;
}

let rooms: FileRooms | null = null;

export function setFileRooms(next: FileRooms | null): void {
  rooms = next;
}

export function fileRooms(): FileRooms | null {
  return rooms;
}

/** While something is dragged, a plugin's frame (a PDF, a chart) must not
 *  take the pointer: the drag would stop at its edge. */
export function setDragging(on: boolean): void {
  document.body.classList.toggle("document-dragging", on);
}
