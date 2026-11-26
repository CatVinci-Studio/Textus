import { imageMimeForPath } from "../../editor/images/pasted-files";

/** What a dragged file is to a document: a picture shown in it, a file
 *  linked from it (a PDF, a spreadsheet, a video), a note of its own, or a
 *  folder. */
export type FileKind = "image" | "attachment" | "note" | "folder";

/** Where over the window it is let go: a document's edge (split), a tab
 *  row, or a document's body. */
export type DropPlace = "edge" | "bar" | "body";

/** What a drop does with one file. */
export type FileAction = "insert" | "open" | "folder";

/** `isDocument`: a file Textus opens as a document of its own. */
export function fileKindOf(
  path: string,
  isDir: boolean,
  isDocument: (path: string) => boolean,
): FileKind {
  if (isDir) return "folder";
  if (imageMimeForPath(path)) return "image";
  return isDocument(path) ? "note" : "attachment";
}

/** Let go on a document's body without Shift: pictures and other files go
 *  into it, a note opens. */
const ON_BODY: Record<FileKind, FileAction> = {
  image: "insert",
  attachment: "insert",
  note: "open",
  folder: "folder",
};

export interface DropFacts {
  place: DropPlace;
  /** Shift is held: whatever it is opens. */
  shift: boolean;
  /** The document under it can take it: editable, and with somewhere to
   *  write it from (a saved document, or a picture from the system, which
   *  a draft keeps with its own). */
  canInsert: boolean;
  /** A plugin writes this file into a document (registerDropHandler). */
  claimed: boolean;
}

/** What one file does where it is let go. */
export function fileAction(kind: FileKind, facts: DropFacts): FileAction {
  if (kind === "folder") return "folder";
  if (facts.place !== "body" || facts.shift) return "open";
  const action = facts.claimed ? "insert" : ON_BODY[kind];
  return action === "insert" && !facts.canInsert ? "open" : action;
}
