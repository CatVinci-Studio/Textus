import type { DirEntryInfo } from "./fs-types";
import type { ImageHost } from "../settings/SettingsContext";
import type * as Generated from "./bindings/files";
import { isIOSApp } from "./capabilities";
import { iosFiles, isScopedUrl, newDocumentPath } from "./ios-files";
import { command, desktopActionCommand, desktopQueryCommand } from "./ipc-call";

/**
 * Backend commands for files and what the app keeps on disk: documents,
 * folders, pictures, the session, stored history and drafts (ipc.ts).
 */

// Generated from the Rust commands (src/platform/bindings/files.ts).
export type {
  SavedImage,
  IndexedFile,
  FolderIndex,
  WordDocument,
} from "./bindings/files";
export type HistoryKind = Generated.HistoryKind;
export type ImageMigration = Generated.ImageMigration_Serialize;
export type DraftSnapshot = Generated.DraftSnapshot_Serialize;

export const fs = {
  // On iOS a picked document is a file:// URL read and written through the
  // native plugin (platform/ios-files.ts); sandbox paths and every desktop
  // path go to Rust as before.
  /** `filters` names the dialog's file-type choices besides Markdown, in
   *  the UI language (commands/fs.rs). */
  openFileDialog: (filters?: {
    textFilter: string;
    wordFilter: string;
    allFilter: string;
  }): Promise<string | null> =>
    isIOSApp
      ? iosFiles.pickDocument()
      : command(
          "open_file_dialog",
          filters?.textFilter ?? null,
          filters?.wordFilter ?? null,
          filters?.allFilter ?? null,
        ),
  openCssFileDialog: () => command("open_css_file_dialog"),
  /** A picker for one image file - "Choose image…" on a missing image's
   *  card (editor/images/missing-image.ts). `filterName` names
   *  `extensions` in the UI language (commands/fs.rs). Offered on
   *  desktop only (capabilities.ts's canPickImageFile). */
  openImageFileDialog: (filterName: string, extensions: readonly string[]) =>
    command("open_image_file_dialog", filterName, [...extensions]),
  /** `defaultDir`: the folder the dialog starts in, when there is one to
   *  suggest - beside the Word file a document was opened from. */
  saveFileDialog: (
    defaultName: string,
    defaultDir: string | null = null,
  ): Promise<string | null> =>
    isIOSApp
      ? newDocumentPath(
          defaultName,
          async (path) => (await command("file_mtime_ms", path)) !== null,
        )
      : command("save_file_dialog", defaultName, defaultDir),
  listDir: (path: string): Promise<DirEntryInfo[]> =>
    isScopedUrl(path) ? iosFiles.listFolder(path) : command("list_dir", path),
  /** The sidebar tree's New Document and New Folder, and moving an entry
   *  into a folder by dragging it there (commands/tree_ops.rs). Each
   *  returns the new path and refuses a name that is already taken.
   *  Desktop only. */
  createDocument: (dir: string, name: string) =>
    desktopActionCommand("tree_create_document", dir, name),
  createFolder: (dir: string, name: string) =>
    desktopActionCommand("tree_create_folder", dir, name),
  moveEntry: (path: string, into: string) =>
    desktopActionCommand("tree_move_entry", path, into),
  /** A new name in the same folder; returns the new path. */
  renameEntry: (path: string, name: string) =>
    desktopActionCommand("tree_rename_entry", path, name),
  /** To the system's Trash, never deleted; refuses the tree's own root. */
  trashEntry: (path: string, root: string) =>
    desktopActionCommand("tree_trash_entry", path, root),
  /** File > Open Folder…'s picker (commands/folder.rs). Rejects with
   *  "TOO_BROAD" for the home folder or a drive root. Desktop only. */
  pickOpenFolder: () => desktopActionCommand("pick_open_folder"),
  /** Every document under `root`, for the sidebar's file-name search
   *  (commands/folder.rs). Rejects with "TOO_BROAD" as the picker does. */
  indexFolder: (root: string) => command("index_folder", root),
  // No change watching for picked documents: the coordinator serialises
  // our writes with iCloud's, and the app re-reads on open.
  fileMtimeMs: (path: string): Promise<number | null> =>
    isScopedUrl(path) ? Promise.resolve(null) : command("file_mtime_ms", path),
  readTextFile: (path: string): Promise<string> =>
    isScopedUrl(path)
      ? iosFiles.readText(path)
      : command("read_text_file", path),
  /** A Word document as the Markdown of a new document, its pictures
   *  saved with the drafts' (commands/word_import.rs). Desktop only. */
  openWordDocument: (path: string) => command("open_word_document", path),
  readBinaryFileBase64: (path: string) =>
    command("read_binary_file_base64", path),
  savePastedImage: (
    docPath: string | null,
    dataBase64: string,
    ext: string,
    folder: string,
  ) => command("save_pasted_image", docPath, dataBase64, ext, folder),
  /** A replaced picture's file to the system's Trash - only one in the
   *  document's folder or the drafts' images. Desktop only. */
  movePictureToTrash: (docPath: string | null, path: string) =>
    command("move_picture_to_trash", docPath, path),
  uploadImage: (
    host: ImageHost,
    dataBase64: string,
    mime: string,
    filename: string,
    endpoint: string,
    urlField: string,
  ) =>
    command(
      "upload_image",
      host,
      dataBase64,
      mime,
      filename,
      endpoint,
      urlField,
    ),
  /** The file an Obsidian image embed names, searched in the document's
   *  vault (commands/vault.rs); null when there is none. */
  resolveVaultImage: (docPath: string, link: string) =>
    command("resolve_vault_image", docPath, link),
  /** The note an Obsidian wikilink names, searched in the document's vault
   *  (commands/vault.rs's resolve_vault_note); null when there is none. */
  resolveVaultNote: (docPath: string, link: string) =>
    command("resolve_vault_note", docPath, link),
  /** `sourceDocPath`: the file a Save As started from, whose relative
   *  images are copied along (commands/fs.rs's migrate_draft_images). */
  migrateDraftImages: (
    docPath: string,
    srcs: string[],
    folder: string,
    sourceDocPath: string | null,
  ) => command("migrate_draft_images", docPath, srcs, folder, sourceDocPath),
  writeTextFile: (path: string, contents: string): Promise<void> =>
    isScopedUrl(path)
      ? iosFiles.writeText(path, contents)
      : command("write_text_file", path, contents),
};

// ---------------------------------------------------------------------------
// session / recents (src-tauri/src/commands/session.rs, recents.rs)
// ---------------------------------------------------------------------------

export const session = {
  updateSessionPaths: (paths: string[]) =>
    desktopQueryCommand("update_session_paths", undefined, paths),
  cancelQuit: () => desktopQueryCommand("cancel_session_quit", undefined),
  addRecentFile: (path: string) => command("add_recent_file", path),
  /** A folder opened in the sidebar, for File > Open Recent. */
  addRecentFolder: (path: string) =>
    desktopQueryCommand("add_recent_folder", undefined, path),
};

// ---------------------------------------------------------------------------
// storage (src-tauri/src/settings.rs) - settings, UI state and the two
// histories, held by Rust in plain JSON files (docs/dev/storage.md). Only called
// when Rust booted this window (src/storage/boot.ts); without that, the
// stores fall back to localStorage.
// ---------------------------------------------------------------------------

/** Snapshot in settings.rs, whose settings Rust holds as plain JSON. */
export interface StoredSnapshot {
  value: Record<string, unknown>;
  rev: number;
}

/** Settings, UI state and history entries are the frontend's shapes, which
 *  Rust keeps as opaque JSON (serde_json::Value): handed over as they are. */
const json = (value: unknown) => value as Generated.Value;
const jsonObject = (value: Record<string, unknown>) =>
  value as Record<string, Generated.Value>;

export const storage = {
  settingsGet: () => command("settings_get") as Promise<StoredSnapshot>,
  /** Top-level fields only; resolves to the new revision. */
  settingsPatch: (patch: Record<string, unknown>) =>
    command("settings_patch", jsonObject(patch)),
  /** Stores the fields of `defaults` that aren't set yet - never over one
   *  that is - and resolves to the live settings. */
  settingsFillDefaults: (defaults: Record<string, unknown>) =>
    command(
      "settings_fill_defaults",
      jsonObject(defaults),
    ) as Promise<StoredSnapshot>,
  uiStateGet: () => command("ui_state_get") as Promise<Record<string, unknown>>,
  uiStatePatch: (patch: Record<string, unknown>) =>
    command("ui_state_patch", jsonObject(patch)),
  historyList: (kind: HistoryKind) =>
    command("history_list", kind) as Promise<unknown[]>,
  historyUpsert: (kind: HistoryKind, entry: unknown) =>
    command("history_upsert", kind, json(entry)),
  historyRemove: (kind: HistoryKind, key: string) =>
    command("history_remove", kind, key),
  historyClear: (kind: HistoryKind) => command("history_clear", kind),
  /** One saved conversation whole (the chat list holds summaries), or
   *  null when its file is gone. */
  chatHistoryGet: (id: string): Promise<unknown> =>
    command("chat_history_get", id),
  /** The saved conversations with every word of `query` in what was
   *  said, newest first (settings/chat_history/search.rs). */
  chatHistorySearch: (query: string): Promise<unknown[]> =>
    command("chat_history_search", query),
  /** How many older conversations were moved to the chat history's trash. */
  chatHistoryArchived: () => command("chat_history_archived"),
  /** A document saved under a new path takes its conversations along. */
  chatHistoryMoveDocument: (from: string, to: string) =>
    command("chat_history_move_document", from, to),
};

// ---------------------------------------------------------------------------
// window / tab-drag (src-tauri/src/tab_drag.rs, App's pending-open queue)
// ---------------------------------------------------------------------------

export const drafts = {
  saveDraftSnapshot: (tabId: string, path: string | null, content: string) =>
    command("save_draft_snapshot", tabId, path, content),
  takeDraftSnapshots: () => command("take_draft_snapshots"),
  clearDraftSnapshot: (tabId: string) => command("clear_draft_snapshot", tabId),
  clearAllDrafts: () => command("clear_all_drafts"),
};

/** What the writer keeps on a document beside the app's data
 *  (src-tauri/src/commands/own_notes.rs), as JSON: their notes, or the
 *  changes they track. */
export const ownNotes = {
  read: (path: string, part: "notes" | "revisions") =>
    command("own_notes_read", path, part),
  write: (path: string, part: "notes" | "revisions", value: string) =>
    command("own_notes_write", path, part, value),
};
