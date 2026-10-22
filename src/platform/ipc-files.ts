import type { DirEntryInfo } from "./fs-types";
import type { ImageHost } from "../settings/SettingsContext";
import { isIOSApp } from "./capabilities";
import { iosFiles, isScopedUrl, newDocumentPath } from "./ios-files";
import { call, desktopAction, desktopQuery } from "./ipc-call";

/**
 * Backend commands for files and what the app keeps on disk: documents,
 * folders, pictures, the session, stored history, drafts, and the Levis
 * import (ipc.ts).
 */

export interface SavedImage {
  src: string;
}

/** One document in a folder index - IndexedFile in
 *  src-tauri/src/commands/folder.rs; change both. */
export interface IndexedFile {
  /** Absolute, to open it. */
  path: string;
  /** From the indexed folder, "/"-separated. */
  rel: string;
}

/** FolderIndex in src-tauri/src/commands/folder.rs; change both. */
export interface FolderIndex {
  files: IndexedFile[];
  /** A limit was hit: the folder may hold more documents than `files`. */
  truncated: boolean;
}

/** WordDocument in src-tauri/src/commands/word_import.rs; change both. */
export interface WordDocument {
  markdown: string;
}

export interface ImageMigration {
  old: string;
  /** New "assets/<name>" relative src on success; null if this one image
   *  failed to migrate (left at its old absolute path). */
  new: string | null;
}

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
      : call<string | null>("open_file_dialog", filters),
  openCssFileDialog: () => call<string | null>("open_css_file_dialog"),
  /** A picker for one image file - "Choose image…" on a missing image's
   *  card (editor/images/missing-image.ts). `filterName` names
   *  `extensions` in the UI language (commands/fs.rs). Offered on
   *  desktop only (capabilities.ts's canPickImageFile). */
  openImageFileDialog: (filterName: string, extensions: readonly string[]) =>
    call<string | null>("open_image_file_dialog", { filterName, extensions }),
  /** `defaultDir`: the folder the dialog starts in, when there is one to
   *  suggest - beside the Word file a document was opened from. */
  saveFileDialog: (
    defaultName: string,
    defaultDir: string | null = null,
  ): Promise<string | null> =>
    isIOSApp
      ? newDocumentPath(
          defaultName,
          async (path) =>
            (await call<number | null>("file_mtime_ms", { path })) !== null,
        )
      : call<string | null>("save_file_dialog", { defaultName, defaultDir }),
  listDir: (path: string): Promise<DirEntryInfo[]> =>
    isScopedUrl(path)
      ? iosFiles.listFolder(path)
      : call<DirEntryInfo[]>("list_dir", { path }),
  /** The sidebar tree's New Document and New Folder, and moving an entry
   *  into a folder by dragging it there (commands/tree_ops.rs). Each
   *  returns the new path and refuses a name that is already taken.
   *  Desktop only. */
  createDocument: (dir: string, name: string) =>
    desktopAction<string>("tree_create_document", { dir, name }),
  createFolder: (dir: string, name: string) =>
    desktopAction<string>("tree_create_folder", { dir, name }),
  moveEntry: (path: string, into: string) =>
    desktopAction<string>("tree_move_entry", { path, into }),
  /** File > Open Folder…'s picker (commands/folder.rs). Rejects with
   *  "TOO_BROAD" for the home folder or a drive root. Desktop only. */
  pickOpenFolder: () => desktopAction<string | null>("pick_open_folder"),
  /** Every document under `root`, for the sidebar's file-name search
   *  (commands/folder.rs). Rejects with "TOO_BROAD" as the picker does. */
  indexFolder: (root: string) => call<FolderIndex>("index_folder", { root }),
  // No change watching for picked documents: the coordinator serialises
  // our writes with iCloud's, and the app re-reads on open.
  fileMtimeMs: (path: string): Promise<number | null> =>
    isScopedUrl(path)
      ? Promise.resolve(null)
      : call<number | null>("file_mtime_ms", { path }),
  readTextFile: (path: string): Promise<string> =>
    isScopedUrl(path)
      ? iosFiles.readText(path)
      : call<string>("read_text_file", { path }),
  /** A Word document as the Markdown of a new document, its pictures
   *  saved with the drafts' (commands/word_import.rs). Desktop only. */
  openWordDocument: (path: string) =>
    call<WordDocument>("open_word_document", { path }),
  readBinaryFileBase64: (path: string) =>
    call<string>("read_binary_file_base64", { path }),
  savePastedImage: (
    docPath: string | null,
    dataBase64: string,
    ext: string,
    folder: string,
  ) =>
    call<SavedImage>("save_pasted_image", { docPath, dataBase64, ext, folder }),
  /** A replaced picture's file to the system's Trash - only one in the
   *  document's folder or the drafts' images. Desktop only. */
  movePictureToTrash: (docPath: string | null, path: string) =>
    call<void>("move_picture_to_trash", { docPath, path }),
  uploadImage: (
    host: ImageHost,
    dataBase64: string,
    mime: string,
    filename: string,
    endpoint: string,
    urlField: string,
  ) =>
    call<SavedImage>("upload_image", {
      host,
      dataBase64,
      mime,
      filename,
      endpoint,
      urlField,
    }),
  /** The file an Obsidian image embed names, searched in the document's
   *  vault (commands/vault.rs); null when there is none. */
  resolveVaultImage: (docPath: string, link: string) =>
    call<string | null>("resolve_vault_image", { docPath, link }),
  /** The note an Obsidian wikilink names, searched in the document's vault
   *  (commands/vault.rs's resolve_vault_note); null when there is none. */
  resolveVaultNote: (docPath: string, link: string) =>
    call<string | null>("resolve_vault_note", { docPath, link }),
  /** `sourceDocPath`: the file a Save As started from, whose relative
   *  images are copied along (commands/fs.rs's migrate_draft_images). */
  migrateDraftImages: (
    docPath: string,
    srcs: string[],
    folder: string,
    sourceDocPath: string | null,
  ) =>
    call<ImageMigration[]>("migrate_draft_images", {
      docPath,
      srcs,
      folder,
      sourceDocPath,
    }),
  writeTextFile: (path: string, contents: string): Promise<void> =>
    isScopedUrl(path)
      ? iosFiles.writeText(path, contents)
      : call<void>("write_text_file", { path, contents }),
};

// ---------------------------------------------------------------------------
// session / recents (src-tauri/src/commands/session.rs, recents.rs)
// ---------------------------------------------------------------------------

export const session = {
  updateSessionPaths: (paths: string[]) =>
    desktopQuery<void>("update_session_paths", undefined, { paths }),
  cancelQuit: () => desktopQuery<void>("cancel_session_quit", undefined),
  addRecentFile: (path: string) => call<void>("add_recent_file", { path }),
  /** A folder opened in the sidebar, for File > Open Recent. */
  addRecentFolder: (path: string) =>
    desktopQuery<void>("add_recent_folder", undefined, { path }),
};

// ---------------------------------------------------------------------------
// storage (src-tauri/src/settings.rs) - settings, UI state and the two
// histories, held by Rust in plain JSON files (docs/dev/storage.md). Only called
// when Rust booted this window (src/storage/boot.ts); without that, the
// stores fall back to localStorage.
// ---------------------------------------------------------------------------

export interface StoredSnapshot {
  value: Record<string, unknown>;
  rev: number;
}

export type HistoryKind = "chat" | "clipboard";

/** What one window read from localStorage at the first launch after the
 *  move, handed over once (see settings_import_legacy). */
export interface LegacyStorage {
  settings: Record<string, unknown>;
  uiState: Record<string, unknown>;
  chatHistory: unknown[] | null;
  clipboardHistory: unknown[] | null;
}

export const storage = {
  settingsGet: () => call<StoredSnapshot>("settings_get"),
  /** Top-level fields only; resolves to the new revision. */
  settingsPatch: (patch: Record<string, unknown>) =>
    call<number>("settings_patch", { patch }),
  /** Stores the fields of `defaults` that aren't set yet - never over one
   *  that is - and resolves to the live settings. */
  settingsFillDefaults: (defaults: Record<string, unknown>) =>
    call<StoredSnapshot>("settings_fill_defaults", { defaults }),
  settingsImportLegacy: (payload: LegacyStorage) =>
    call<StoredSnapshot & { accepted: boolean }>("settings_import_legacy", {
      payload,
    }),
  uiStateGet: () => call<Record<string, unknown>>("ui_state_get"),
  uiStatePatch: (patch: Record<string, unknown>) =>
    call<void>("ui_state_patch", { patch }),
  historyList: (kind: HistoryKind) => call<unknown[]>("history_list", { kind }),
  historyUpsert: (kind: HistoryKind, entry: unknown) =>
    call<void>("history_upsert", { kind, entry }),
  historyRemove: (kind: HistoryKind, key: string) =>
    call<void>("history_remove", { kind, key }),
  historyClear: (kind: HistoryKind) => call<void>("history_clear", { kind }),
  /** One saved conversation whole (the chat list holds summaries), or
   *  null when its file is gone. */
  chatHistoryGet: (id: string) =>
    call<unknown | null>("chat_history_get", { id }),
  /** How many older conversations were moved to the chat history's trash. */
  chatHistoryArchived: () => call<number>("chat_history_archived"),
  /** A document saved under a new path takes its conversations along. */
  chatHistoryMoveDocument: (from: string, to: string) =>
    call<void>("chat_history_move_document", { from, to }),
};

// ---------------------------------------------------------------------------
// Levis import (src-tauri/src/levis_import.rs)
// ---------------------------------------------------------------------------

/** What a Levis installation can bring (levis_import.rs `Item`). */
export type LevisItem =
  | "settings"
  | "chatHistory"
  | "clipboardHistory"
  | "themes"
  | "writingInstructions"
  | "skills"
  | "recentFiles"
  | "session"
  | "drafts"
  | "credentials";

export interface LevisImportStatus {
  supported: boolean;
  levisDir: string | null;
  items: LevisItem[];
}

export interface LevisImportReport {
  imported: LevisItem[];
  kept: string[];
  failed: string[];
}

export const levisImport = {
  status: () => call<LevisImportStatus>("levis_import_status"),
  run: (includeCredentials: boolean) =>
    call<LevisImportReport>("levis_import", { includeCredentials }),
};

// ---------------------------------------------------------------------------
// window / tab-drag (src-tauri/src/tab_drag.rs, App's pending-open queue)
// ---------------------------------------------------------------------------

export interface DraftSnapshot {
  tabId: string;
  path: string | null;
  content: string;
}

export const drafts = {
  saveDraftSnapshot: (tabId: string, path: string | null, content: string) =>
    call<void>("save_draft_snapshot", { tabId, path, content }),
  takeDraftSnapshots: () => call<DraftSnapshot[]>("take_draft_snapshots"),
  clearDraftSnapshot: (tabId: string) =>
    call<void>("clear_draft_snapshot", { tabId }),
  clearAllDrafts: () => call<void>("clear_all_drafts"),
};
