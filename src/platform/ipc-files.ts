import type { DirEntryInfo } from "./fs-types";
import type { ImageHost } from "../prefs/SettingsContext";
import type * as Generated from "./bindings/files";
import { isIOSApp } from "./capabilities";
import { iosFiles, isScopedUrl, newDocumentPath } from "./ios-files";
import { command, desktopActionCommand, desktopQueryCommand } from "./ipc-call";

/**
 * Backend commands for files and what the app keeps on disk: documents,
 * folders, pictures, the session, stored history and drafts.
 */

export type {
  SavedImage,
  IndexedFile,
  FolderIndex,
  WordDocument,
} from "./bindings/files";
export type HistoryKind = Generated.HistoryKind;

export const fs = {
  // On iOS a picked document is a file:// URL read and written through the
  // native plugin; every other path goes to Rust.
  /** `filters` names the dialog's file-type choices besides Markdown, in
   *  the UI language. */
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
  /** A picker for one image file. `filterName` names `extensions` in the UI
   *  language. Desktop only. */
  openImageFileDialog: (filterName: string, extensions: readonly string[]) =>
    command("open_image_file_dialog", filterName, [...extensions]),
  /** `defaultDir`: the folder the dialog starts in, if any to suggest. */
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
  /** The sidebar tree's New Document, New Folder and drag-to-move. Each
   *  returns the new path and refuses a taken name. Desktop only. */
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
  /** File > Open Folder…'s picker. Rejects with "TOO_BROAD" for the home
   *  folder or a drive root. Desktop only. */
  pickOpenFolder: () => desktopActionCommand("pick_open_folder"),
  /** Every document under `root`, for the sidebar's file-name search.
   *  Rejects with "TOO_BROAD" as the picker does. */
  indexFolder: (root: string) => command("index_folder", root),
  // No change watching for picked documents: the coordinator serialises
  // our writes with iCloud's, and the app re-reads on open.
  fileMtimeMs: (path: string): Promise<number | null> =>
    isScopedUrl(path) ? Promise.resolve(null) : command("file_mtime_ms", path),
  readTextFile: (path: string): Promise<string> =>
    isScopedUrl(path)
      ? iosFiles.readText(path)
      : command("read_text_file", path),
  /** A Word document as a new document's Markdown, its pictures saved with
   *  the drafts'. Desktop only. */
  openWordDocument: (path: string) => command("open_word_document", path),
  readBinaryFileBase64: (path: string) =>
    command("read_binary_file_base64", path),
  savePastedImage: (
    docPath: string | null,
    dataBase64: string,
    ext: string,
    folder: string,
  ) => command("save_pasted_image", docPath, dataBase64, ext, folder),
  /** A replaced picture's file to the Trash, only from the document's folder
   *  or the drafts' images. Desktop only. */
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
  /** The file an Obsidian image embed names in the document's vault, or
   *  null; `folder` is the one open in the window. */
  resolveVaultImage: (docPath: string, link: string, folder: string | null) =>
    command("resolve_vault_image", docPath, link, folder),
  /** The note an Obsidian wikilink names in the document's vault, or null. */
  resolveVaultNote: (docPath: string, link: string, folder: string | null) =>
    command("resolve_vault_note", docPath, link, folder),
  /** `sourceDocPath`: the file a Save As started from, whose relative
   *  images are copied along. */
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

// Session and recents

export const session = {
  updateSessionPaths: (paths: string[]) =>
    desktopQueryCommand("update_session_paths", undefined, paths),
  cancelQuit: () => desktopQueryCommand("cancel_session_quit", undefined),
  addRecentFile: (path: string) => command("add_recent_file", path),
  /** A folder opened in the sidebar, for File > Open Recent. */
  addRecentFolder: (path: string) =>
    desktopQueryCommand("add_recent_folder", undefined, path),
};

// Storage: settings, UI state and histories, held by Rust as JSON files.
// Only called when Rust booted this window; otherwise the stores use localStorage.

/** A settings snapshot and its revision. */
export interface StoredSnapshot {
  value: Record<string, unknown>;
  rev: number;
}

/** The frontend's shapes, which Rust keeps as opaque JSON, handed over as they are. */
const json = (value: unknown) => value as Generated.Value;
const jsonObject = (value: Record<string, unknown>) =>
  value as Record<string, Generated.Value>;

export const storage = {
  settingsGet: () => command("settings_get") as Promise<StoredSnapshot>,
  /** Top-level fields only; resolves to the new revision. */
  settingsPatch: (patch: Record<string, unknown>) =>
    command("settings_patch", jsonObject(patch)),
  /** Stores the fields of `defaults` not set yet and resolves to the live
   *  settings. */
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
  /** Saved conversations with every word of `query`, newest first. */
  chatHistorySearch: (query: string): Promise<unknown[]> =>
    command("chat_history_search", query),
  /** How many older conversations were moved to the chat history's trash. */
  chatHistoryArchived: () => command("chat_history_archived"),
  /** A document saved under a new path takes its conversations along. */
  chatHistoryMoveDocument: (from: string, to: string) =>
    command("chat_history_move_document", from, to),
};

// Drafts

export const drafts = {
  saveDraftSnapshot: (tabId: string, path: string | null, content: string) =>
    command("save_draft_snapshot", tabId, path, content),
  takeDraftSnapshots: () => command("take_draft_snapshots"),
  clearDraftSnapshot: (tabId: string) => command("clear_draft_snapshot", tabId),
  clearAllDrafts: () => command("clear_all_drafts"),
};

/** What the writer keeps on a document beside the app's data, as JSON:
 *  their notes, or the changes they track. */
export const ownNotes = {
  read: (path: string, part: "notes" | "revisions") =>
    command("own_notes_read", path, part),
  write: (path: string, part: "notes" | "revisions", value: string) =>
    command("own_notes_write", path, part, value),
};
