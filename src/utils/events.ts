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

/// detail: a ChatHistoryEntry to load as the live conversation and open the
/// inline chat on (chat history sidebar panel).
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

/// Fired once a chat message actually goes out (InlineChat.tsx's send), not
/// just when the chat panel opens - the interactive tutorial's "ask AI
/// something" step listens for this to know the user really did it. Only
/// the tutorial's own mock chat dispatches it (InlineChat's tutorialMock
/// prop), so sends in other tabs never advance the tour.
export const AI_MESSAGE_SENT_EVENT = "textus:ai-message-sent";

/// Fired after the first-run Agent editing exercise has produced a real
/// in-document proposal preview. The lesson waits for this rather than the
/// earlier message-sent event, so it never tells the learner to accept a
/// change before the preview actually exists.
export const TUTORIAL_AGENT_PROPOSAL_EVENT = "textus:tutorial-agent-proposal";

/// detail: the suggestion string. The tutorial's completion step showing a
/// PRE-WRITTEN ghost suggestion at the caret (ghost-text-plugin's
/// showGhostSuggestion) - first-run users have no AI account yet, so the
/// tour never calls the real backend.
export const TUTORIAL_MOCK_GHOST_EVENT = "textus:tutorial-mock-ghost";

/// detail: a TutorialGrammarMock (tutorial-evaluation.ts) - the practice
/// sentence plus issues with sentence-relative offsets. The tutorial's
/// grammar step underlining a PRE-WRITTEN issue in the practice paragraph
/// (grammar-check-plugin's showGrammarIssues, after the consumer re-bases
/// the offsets onto the cursor's paragraph) - same no-backend reasoning as
/// the ghost event above.
export const TUTORIAL_MOCK_GRAMMAR_EVENT = "textus:tutorial-mock-grammar";

/** Open a file in a new tab (the project bar's style profile and library
 *  entries) - detail: the absolute path. Handled by App. */
export const OPEN_FILE_IN_TAB_EVENT = "textus:open-file-in-tab";

/** Zen mode turned on/off (detail: boolean) - editors refresh their
 *  focus dimming (zen-focus-plugin). Fired by App. */
export const ZEN_MODE_EVENT = "textus:zen-mode";
