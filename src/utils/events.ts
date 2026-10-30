/// Window CustomEvent names linking global shortcuts to the mounted editor
/// without a direct import between the two.
export const TRIGGER_COMPLETION_EVENT = "textus:trigger-completion";
export const TRIGGER_GRAMMAR_CHECK_EVENT = "textus:trigger-grammar-check";
export const TOGGLE_FLOATING_CHAT_EVENT = "textus:toggle-floating-chat";
export const TOGGLE_FIND_REPLACE_EVENT = "textus:toggle-find-replace";
/// Closes the find bar: the iPhone's sidebar drawer opens over it.
export const CLOSE_FIND_REPLACE_EVENT = "textus:close-find-replace";

/// detail: `{ paths, point }`, image files dropped on the window from a file
/// manager and where they landed; the editor on screen inserts them.
export const DROP_IMAGE_FILES_EVENT = "textus:drop-image-files";

/// detail: the markdown text to insert at the cursor.
export const INSERT_CLIPBOARD_TEXT_EVENT = "textus:insert-clipboard-text";

/// A saved conversation is waiting to be restored by the editor it is for.
export const RESTORE_CHAT_EVENT = "textus:restore-chat";

/// detail: "undo", "redo", "cut", "copy", "paste" or "select-all". Native
/// predefined menu items have no id, so on Windows they come through here.
export const EDIT_ACTION_EVENT = "textus:edit-action";

/// detail: what to do with the writer's tracked changes in the document on screen.
export const TRACK_CHANGES_EVENT = "textus:track-changes";
export type TrackChangesAction = "toggle" | "accept-all" | "reject-all";

/// detail: the block kind to insert at the cursor: "h1".."h6", "bullet-list",
/// "ordered-list", "blockquote", "code-block", "table" or "paragraph".
export const INSERT_BLOCK_EVENT = "textus:insert-block";

/// detail: "heading" | "bullet-list" | "ordered-list" | "blockquote"; these
/// toggle rather than only insert.
export const TOGGLE_BLOCK_EVENT = "textus:toggle-block";

/// detail: "bold" | "italic": toggles the mark on the selection.
export const TOGGLE_MARK_EVENT = "textus:toggle-mark";

/// detail: a TableAction ("row-below", "delete-column"…) for the table under the caret.
export const TABLE_ACTION_EVENT = "textus:table-action";

/// detail: "width:auto" | "width:<percent>" | "delete", for the selected image.
export const IMAGE_ACTION_EVENT = "textus:image-action";

/// Opens the editor's menu for the caret as an action sheet, standing in for
/// the right-click a phone doesn't have.
export const EDITOR_MORE_EVENT = "textus:editor-more";

/// The AI of the tour's practice tab: "muted" keeps completion and the
/// grammar check quiet; "live" is the real thing, as outside the tour.
export type TourAi = "muted" | "live";

/// What the learner did in the tour's practice tab that a lesson waits for.
export type TourSignal =
  /** A completion suggestion was taken (Tab, or a tap on a phone). */
  | "completion-accepted"
  /** A grammar card opened on an underline. */
  | "grammar-card"
  /** An AI revision was accepted or rejected, all of it decided. */
  | "revision-decided"
  /** A review note was pinned to the text. */
  | "review-note"
  /** The AI finished answering a message without an error. */
  | "reply"
  /** A message went out through a skill (`/name`). */
  | "skill-sent"
  /** A command ran from the command palette. */
  | "palette-command";

/// detail: a TourSignal.
export const TOUR_SIGNAL_EVENT = "textus:tour-signal";

export function sendTourSignal(signal: TourSignal): void {
  window.dispatchEvent(
    new CustomEvent<TourSignal>(TOUR_SIGNAL_EVENT, { detail: signal }),
  );
}

/** Open a file in a new tab. detail: the absolute path, or an OpenFileInTab. */
export const OPEN_FILE_IN_TAB_EVENT = "textus:open-file-in-tab";

/** A link into a file: the heading it names is scrolled to once it's on screen. */
export interface OpenFileInTab {
  path: string;
  anchor?: string;
}

/** Zen mode turned on/off (detail: boolean). */
export const ZEN_MODE_EVENT = "textus:zen-mode";

/** A file was written from inside the window, not by its tab's save
 *  (detail: its path); open tabs of it check the disk. */
export const FILE_WRITTEN_EVENT = "textus:file-written";
