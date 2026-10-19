/// Shared window CustomEvent names for wiring global keyboard shortcuts
/// (handled in App.tsx) to the currently mounted editor instance
/// (MilkdownEditor.tsx) without a direct import between the two.
export const TRIGGER_COMPLETION_EVENT = "textus:trigger-completion";
export const TRIGGER_GRAMMAR_CHECK_EVENT = "textus:trigger-grammar-check";
export const TOGGLE_FLOATING_CHAT_EVENT = "textus:toggle-floating-chat";
export const TOGGLE_FIND_REPLACE_EVENT = "textus:toggle-find-replace";
/// Closes the find bar if it is open: the iPhone's sidebar drawer opens
/// over the top of the page, where the bar sits.
export const CLOSE_FIND_REPLACE_EVENT = "textus:close-find-replace";

/// detail: `{ paths, point }` - image files dropped on the window from a
/// file manager, and where in the page they landed (app/useFileOpening.ts's
/// useFileDrop). The editor on screen inserts them (images/image-plugin.ts).
export const DROP_IMAGE_FILES_EVENT = "textus:drop-image-files";

/// detail: the markdown text to insert at the cursor (clipboard history panel).
export const INSERT_CLIPBOARD_TEXT_EVENT = "textus:insert-clipboard-text";

/// A saved conversation is waiting to be restored (Chats sidebar panel):
/// the editor it is for takes it from ai/chat/chat-restore.ts.
export const RESTORE_CHAT_EVENT = "textus:restore-chat";

/// detail: an editing action from the app-drawn menu's Edit submenu -
/// "undo", "redo", "cut", "copy", "paste" or "select-all" (see
/// app/app-menu-actions.ts). Those items are `PredefinedMenuItem`s in the
/// native menu, which has no id to address them by, so on Windows they come
/// through here to the editor instead.
export const EDIT_ACTION_EVENT = "textus:edit-action";

/// detail: the block kind to insert at the cursor, from the native Format
/// menu (see menu-insert-block in src-tauri/src/lib.rs) - "h1".."h6",
/// "bullet-list", "ordered-list", "blockquote", "code-block", or "table".
export const INSERT_BLOCK_EVENT = "textus:insert-block";

/// detail: "heading" | "bullet-list" | "ordered-list" | "blockquote" - the
/// iPhone keyboard toolbar's block buttons, which toggle rather than only
/// insert (editor/keys/block-toggles.ts).
export const TOGGLE_BLOCK_EVENT = "textus:toggle-block";

/// detail: "bold" | "italic" - makes the selection bold or italic, or plain
/// again (editor/marks/span-commands.ts; the iPhone's keyboard toolbar).
export const TOGGLE_MARK_EVENT = "textus:toggle-mark";

/// detail: a TableAction (editor/editor-menu.ts) - "row-below",
/// "delete-column" and so on - for the table under the caret: the iPhone
/// keyboard toolbar's table buttons.
export const TABLE_ACTION_EVENT = "textus:table-action";

/// detail: "width:auto" | "width:<percent>" | "delete" - for the selected
/// image: the iPhone keyboard toolbar's image buttons.
export const IMAGE_ACTION_EVENT = "textus:image-action";

/// Opens the editor's menu for where the caret is, as an action sheet
/// (editor-menu.ts's buildPhoneMoreItems): the iPhone keyboard toolbar's
/// "More" button, standing in for the right-click a phone doesn't have.
export const EDITOR_MORE_EVENT = "textus:editor-more";

/// The AI of the tour's practice tab (onboarding/): "muted" while the
/// lesson isn't about it, or the learner chose to watch the animations
/// instead of connecting one - completion and the grammar check stay quiet
/// and their shortcuts do nothing; "live" for the AI lessons of a learner
/// who connected one - the real thing, exactly as outside the tour.
export type TourAi = "muted" | "live";

/// What the learner did in the tour's practice tab that a lesson waits
/// for. Sent only by the practice tab's editor (MilkdownEditor's `tour`).
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
  | "skill-sent";

/// detail: a TourSignal. See useTutorial's listener.
export const TOUR_SIGNAL_EVENT = "textus:tour-signal";

export function sendTourSignal(signal: TourSignal): void {
  window.dispatchEvent(
    new CustomEvent<TourSignal>(TOUR_SIGNAL_EVENT, { detail: signal }),
  );
}

/** Open a file in a new tab (the project bar's style profile and library
 *  entries) - detail: the absolute path. Handled by App. */
export const OPEN_FILE_IN_TAB_EVENT = "textus:open-file-in-tab";

/** Zen mode turned on/off (detail: boolean) - editors refresh their
 *  focus dimming (zen-focus-plugin). Fired by App. */
export const ZEN_MODE_EVENT = "textus:zen-mode";
