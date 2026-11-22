/// Window CustomEvent names linking global shortcuts to the mounted editor
/// without a direct import between the two.
export const TRIGGER_COMPLETION_EVENT = "textus:trigger-completion";
export const TRIGGER_GRAMMAR_CHECK_EVENT = "textus:trigger-grammar-check";
export const TOGGLE_FLOATING_CHAT_EVENT = "textus:toggle-floating-chat";
export const TOGGLE_FIND_REPLACE_EVENT = "textus:toggle-find-replace";
/** Edit › Replace… and Find Next. */
export const SHOW_REPLACE_EVENT = "textus:show-replace";
export const FIND_NEXT_EVENT = "textus:find-next";
/** Format › Link: a link around the selection. */
export const INSERT_LINK_EVENT = "textus:insert-link";
/// detail: Markdown put in at the caret of the document on screen (an AI
/// reply's Insert at Cursor).
export const INSERT_MARKDOWN_EVENT = "textus:insert-markdown";
/// detail: a file's path - the file tree's Insert Link: a link to it at the
/// caret of the document in use, written as that folder writes links.
export const LINK_TO_FILE_EVENT = "textus:link-to-file";
/// detail: a sidebar tab's id - a plugin asked for it to be shown
/// (layout.showSidebarTab); the sidebar opens on it.
export const SHOW_SIDEBAR_TAB_EVENT = "textus:show-sidebar-tab";
/// Closes the find bar: the iPhone's sidebar drawer opens over it.
export const CLOSE_FIND_REPLACE_EVENT = "textus:close-find-replace";

/// detail: `{ paths, point }`, image files dropped on the window from another
/// app (iPad) and where they landed; the editor on screen inserts them.
export const DROP_IMAGE_FILES_EVENT = "textus:drop-image-files";

/// A saved conversation is waiting to be restored by the editor it is for.
export const RESTORE_CHAT_EVENT = "textus:restore-chat";

/// detail: "undo", "redo", "cut", "copy", "paste" or "select-all". Native
/// predefined menu items have no id, so on Windows they come through here.
export const EDIT_ACTION_EVENT = "textus:edit-action";

/// On the source editor's content, detail "undo", "redo" or "select-all": the
/// Edit menu asking CodeMirror for its own, whose history the system's
/// commands don't reach off macOS.
export const SOURCE_EDIT_EVENT = "textus:source-edit";

/// detail: what to do with the writer's tracked changes in the document on screen.
export const TRACK_CHANGES_EVENT = "textus:track-changes";
export type TrackChangesAction = "toggle" | "accept-all" | "reject-all";

/// detail: the block kind to insert at the cursor (editor/blocks/block-kinds).
export const INSERT_BLOCK_EVENT = "textus:insert-block";
/** A folder inside the open one to show in the sidebar (detail: its path),
 *  as its Show Only This Folder does: a plugin's import going into what it made. */
export const SHOW_FOLDER_EVENT = "textus:show-folder";
/** A folder a plugin provides (`ssh://host/…`) to open as the window's
 *  folder (detail: its URL). */
export const OPEN_FOLDER_EVENT = "textus:open-folder";

/// detail: "heading" | "bullet-list" | "ordered-list" | "blockquote"; these
/// toggle rather than only insert.
export const TOGGLE_BLOCK_EVENT = "textus:toggle-block";

/// detail: "bold" | "italic" | "highlight": toggles the mark on the selection.
export const TOGGLE_MARK_EVENT = "textus:toggle-mark";

/// detail: a TableAction ("row-below", "delete-column"…) for the table under the caret.
export const TABLE_ACTION_EVENT = "textus:table-action";

/// detail: "width:auto" | "width:<percent>" | "delete", for the selected image.
export const IMAGE_ACTION_EVENT = "textus:image-action";

/// Opens the editor's menu for the caret as an action sheet, standing in for
/// the right-click a phone doesn't have.
export const EDITOR_MORE_EVENT = "textus:editor-more";
/** The phone's keyboard has come up (mobile/keyboard.ts). */
export const KEYBOARD_UP_EVENT = "textus:keyboard-up";

/// The AI of the tour's practice tab: "muted" keeps completion and the
/// grammar check quiet; "live" is the real thing, as outside the tour.
export type TourAi = "muted" | "live";

/// What the learner did in the tour's practice tab that a lesson waits for.
export type TourSignal =
  /** An AI revision was accepted or rejected, all of it decided. */
  "revision-decided";

/// detail: a TourSignal.
export const TOUR_SIGNAL_EVENT = "textus:tour-signal";

export function sendTourSignal(signal: TourSignal): void {
  window.dispatchEvent(
    new CustomEvent<TourSignal>(TOUR_SIGNAL_EVENT, { detail: signal }),
  );
}

/** Zen mode turned on/off (detail: boolean). */
export const ZEN_MODE_EVENT = "textus:zen-mode";

/** A file was written from inside the window, not by its tab's save
 *  (detail: its path); open tabs of it check the disk. */
export const FILE_WRITTEN_EVENT = "textus:file-written";

/** The app made a file of the user's: a picture pasted or dropped into a
 *  document, a new document, a draft's first file (detail: its path). */
export const FILE_CREATED_EVENT = "textus:file-created";

export function announceFileCreated(path: string) {
  window.dispatchEvent(new CustomEvent(FILE_CREATED_EVENT, { detail: path }));
}

/** A file or folder the sidebar moved to the Trash; detail: its path. */
export const ENTRY_TRASHED_EVENT = "textus:entry-trashed";

/** A tab took its file's new text from disk (detail: its path). */
export const FILE_RELOADED_EVENT = "textus:file-reloaded";

/** Asks an editor window to open Textus AI's panel (a floating view's
 *  menu, from its own window). */
export const OPEN_AGENT_PANEL_EVENT = "open-agent-panel";

/** A block handle's ⋮⋮ pressed: its editor's menu for that block. */
export const BLOCK_MENU_EVENT = "textus:block-menu";
export interface BlockMenuRequest {
  /** The editor the block is in. */
  dom: HTMLElement;
  x: number;
  y: number;
  pos: number;
}

/** What each window event above carries; undefined for none. */
interface AppEvents {
  [TRIGGER_COMPLETION_EVENT]: undefined;
  [TRIGGER_GRAMMAR_CHECK_EVENT]: undefined;
  [TOGGLE_FLOATING_CHAT_EVENT]: undefined;
  [TOGGLE_FIND_REPLACE_EVENT]: undefined;
  [SHOW_REPLACE_EVENT]: undefined;
  [FIND_NEXT_EVENT]: undefined;
  [INSERT_LINK_EVENT]: undefined;
  [INSERT_MARKDOWN_EVENT]: string;
  [LINK_TO_FILE_EVENT]: string;
  [SHOW_SIDEBAR_TAB_EVENT]: string;
  [CLOSE_FIND_REPLACE_EVENT]: undefined;
  [DROP_IMAGE_FILES_EVENT]: {
    paths: string[];
    point: { x: number; y: number } | null;
  };
  [RESTORE_CHAT_EVENT]: undefined;
  [EDIT_ACTION_EVENT]: string;
  [TRACK_CHANGES_EVENT]: TrackChangesAction;
  [INSERT_BLOCK_EVENT]: string;
  [SHOW_FOLDER_EVENT]: string;
  [OPEN_FOLDER_EVENT]: string;
  [TOGGLE_BLOCK_EVENT]: string;
  [TOGGLE_MARK_EVENT]: string;
  [TABLE_ACTION_EVENT]: string;
  [IMAGE_ACTION_EVENT]: string;
  [EDITOR_MORE_EVENT]: undefined;
  [KEYBOARD_UP_EVENT]: undefined;
  [TOUR_SIGNAL_EVENT]: TourSignal;
  [ZEN_MODE_EVENT]: boolean;
  [FILE_WRITTEN_EVENT]: string;
  [FILE_CREATED_EVENT]: string;
  [ENTRY_TRASHED_EVENT]: string;
  [FILE_RELOADED_EVENT]: string;
  [BLOCK_MENU_EVENT]: BlockMenuRequest;
}

export type AppEventName = keyof AppEvents;

/** The events that carry text, or nothing: a button's or a key's. */
export type TextEventName = {
  [K in AppEventName]: AppEvents[K] extends string | undefined ? K : never;
}[AppEventName];

/** Tells the window `name` happened: the one way these are sent. */
export function sendAppEvent<K extends AppEventName>(
  name: K,
  ...detail: AppEvents[K] extends undefined ? [] : [AppEvents[K]]
): void {
  window.dispatchEvent(new CustomEvent(name, { detail: detail[0] }));
}
