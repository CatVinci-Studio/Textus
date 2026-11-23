import { ownError } from "../utils/error-text";
import {
  type DirEntryInfo,
  type WindowSession_Deserialize,
} from "./bindings/files";
import type { ImageHost } from "../prefs/SettingsContext";
import type * as Generated from "./bindings/files";
import { isIOSApp, isMobileApp } from "./capabilities";
import { nativeFiles, newDocumentPath } from "./native-files";
import { farEntries, farFiles, isFarUrl } from "./far-files";
import { parentDir } from "../utils/path";
import { scopedFolder } from "./scoped-folder";
import { command, desktopActionCommand, desktopQueryCommand } from "./ipc-call";
import { onOpenFolder, openFolderOnDisk } from "./open-folder";

/**
 * Backend commands for files and what the app keeps on disk: documents,
 * folders, pictures, the session, stored history and drafts.
 */

export type HistoryKind = Generated.HistoryKind;

export const fs = {
  // On iOS a picked document is a file:// URL, on Android a content:// one,
  // read and written through the native plugin; every other path goes to
  // Rust.
  /** `filters` names the dialog's file-type choices besides Markdown, in
   *  the UI language. */
  openFileDialog: (filters?: {
    textFilter: string;
    wordFilter: string;
    allFilter: string;
  }): Promise<string | null> =>
    isMobileApp
      ? nativeFiles.pickDocument()
      : command(
          "open_file_dialog",
          filters?.textFilter ?? null,
          filters?.wordFilter ?? null,
          filters?.allFilter ?? null,
        ),
  openCssFileDialog: () => command("open_css_file_dialog"),
  /** Pickers for a settings file, in and out. Desktop only. */
  openSettingsFileDialog: () => command("open_settings_file_dialog"),
  saveSettingsFileDialog: (defaultName: string) =>
    command("save_settings_file_dialog", defaultName),
  /** A picker for one image file. `filterName` names `extensions` in the UI
   *  language. Desktop only. */
  openImageFileDialog: (filterName: string, extensions: readonly string[]) =>
    command("open_image_file_dialog", filterName, [...extensions]),
  /** `defaultDir`: the folder the dialog starts in, if any to suggest. */
  saveFileDialog: (
    defaultName: string,
    defaultDir: string | null = null,
  ): Promise<string | null> =>
    !isMobileApp
      ? command("save_file_dialog", defaultName, defaultDir)
      : !isIOSApp
        ? nativeFiles.createDocument(defaultName)
        : newDocumentPath(
            defaultName,
            async (path) => (await command("file_mtime_ms", path)) !== null,
          ),
  listDir: (path: string): Promise<DirEntryInfo[]> =>
    isFarUrl(path)
      ? farFiles(path).listFolder(path)
      : command("list_dir", path),
  /** The sidebar tree's New Document, New Folder and drag-to-move. Each
   *  returns the new path and refuses a taken name. */
  createDocument: (dir: string, name: string): Promise<string> =>
    farEntries(dir)?.createEntry(dir, name, false) ??
    command("tree_create_document", dir, name),
  createFolder: (dir: string, name: string): Promise<string> =>
    farEntries(dir)?.createEntry(dir, name, true) ??
    command("tree_create_folder", dir, name),
  moveEntry: (path: string, into: string): Promise<string> => {
    const far = farEntries(path);
    const from = far && parentDir(path);
    return far && from
      ? far.moveEntry(path, from, into)
      : command("tree_move_entry", path, into);
  },
  /** A file or folder from a file manager copied into the tree's folder
   *  `into`, numbered when its name is taken; returns the copy's path.
   *  Rust side: `copy_into_folder` (commands/fs/copy_into.rs). Desktop
   *  only, and never into a far folder (the tree doesn't offer it). */
  copyIntoFolder: (source: string, into: string): Promise<string> =>
    command("copy_into_folder", source, into),
  /** A new name in the same folder; returns the new path. */
  renameEntry: (path: string, name: string): Promise<string> =>
    farEntries(path)?.renameEntry(path, name) ??
    command("tree_rename_entry", path, name),
  /** To the system's Trash; refuses the tree's own root. A phone has none:
   *  there a document is deleted (the tree asks first), a folder never. */
  trashEntry: (path: string, root: string): Promise<void> =>
    isIOSApp
      ? nativeFiles.trash(path)
      : isFarUrl(path)
        ? farFiles(path)
            .deleteEntry(path)
            .then(() => {})
        : command("tree_trash_entry", path, root),
  /** File > Open Folder…'s picker. Rejects with "TOO_BROAD" for the home
   *  folder or a drive root. A phone's is the system's folder picker. */
  pickOpenFolder: (): Promise<string | null> =>
    isMobileApp
      ? nativeFiles.pickProjectFolder()
      : desktopActionCommand("pick_open_folder"),
  /** Every document under `root`, for the sidebar's file-name search.
   *  Rejects with "TOO_BROAD" as the picker does. */
  indexFolder: (root: string) =>
    isFarUrl(root) ? scopedFolder.index(root) : command("index_folder", root),
  /** The lines of the documents under `root` holding `query`, ignoring
   *  case, for the Search page. Rejects as `indexFolder` does. */
  searchFolderText: (root: string, query: string) =>
    isFarUrl(root)
      ? scopedFolder.search(root, query)
      : command("search_folder_text", root, query),
  /** Every Markdown document under `root` with its text, for the links a
   *  rename updates. Rejects as `indexFolder` does. */
  folderDocuments: (root: string) =>
    isFarUrl(root)
      ? scopedFolder.documents(root)
      : command("folder_documents", root),
  // No change watching for picked documents: the coordinator serialises
  // our writes with iCloud's, and the app re-reads on open.
  /** A picture's size from its file's header, before it loads; null where
   *  that can't be read (SVG, a far file). */
  pictureSize: (
    path: string,
  ): Promise<{ width: number; height: number } | null> =>
    isFarUrl(path) ? Promise.resolve(null) : command("picture_size", path),
  fileMtimeMs: (path: string): Promise<number | null> =>
    isFarUrl(path) ? Promise.resolve(null) : command("file_mtime_ms", path),
  readTextFile: (path: string): Promise<string> =>
    isFarUrl(path)
      ? farFiles(path).readText(path)
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
  ) =>
    docPath && isFarUrl(docPath)
      ? Promise.reject(new Error(ownError("farPictures")))
      : command("save_pasted_image", docPath, dataBase64, ext, folder),
  /** A file dropped from a file manager, copied where the document's
   *  pictures go, to link to. */
  saveDroppedFile: (docPath: string, source: string, folder: string) =>
    isFarUrl(docPath)
      ? Promise.reject(new Error(ownError("farPictures")))
      : command("save_dropped_file", docPath, source, folder),
  /** A replaced picture's file to the Trash, only from the document's folder
   *  or the drafts' images. Desktop only. */
  movePictureToTrash: (docPath: string | null, path: string) =>
    isFarUrl(path)
      ? Promise.resolve(null)
      : command("move_picture_to_trash", docPath, path),
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
  /** Where a link's note part leads in the document's vault (a wikilink's
   *  name, or a Markdown link's path): the file, or where following it
   *  creates it; null outside the vault. */
  resolveNoteLink: (
    docPath: string,
    link: string,
    folder: string | null,
    wiki: boolean,
  ) => command("resolve_note_link", docPath, link, folder, wiki),
  /** The folder a link from `/` is read from (typora-root-url, the git
   *  repository, the vault, the open folder); null for the disk's root. */
  documentLinkRoot: (docPath: string, folder: string | null) =>
    isFarUrl(docPath)
      ? Promise.resolve(null)
      : command("document_link_root", docPath, folder),
  /** How the folder of a document (or a folder) is written, whichever app
   *  made it: links, pictures, line breaks, templates, daily notes. Read
   *  only; a field no app sets is left to Textus's settings. */
  folderConventions: (path: string) =>
    isFarUrl(path)
      ? Promise.resolve(NO_CONVENTIONS)
      : command("folder_conventions", path),
  /** A project's .textus/settings.json as a whole, comments allowed; {}
   *  when there is none. */
  projectSettings: (root: string) =>
    isFarUrl(root)
      ? Promise.resolve({})
      : command("project_settings_read", root),
  /** The plugins' folder convention readers in this window. */
  conventionReaders: (readers: Generated.PluginReader_Deserialize[]) =>
    command("conventions_readers", readers),
  /** Marker files above `path` that a plugin's reader hasn't answered. */
  conventionsPending: (path: string) => command("conventions_pending", path),
  /** A plugin reader's answer for the marker text it was handed. */
  conventionsAnswer: (
    app: string,
    root: string,
    text: string,
    found: Generated.Found_Deserialize | null,
  ) => command("conventions_answer", app, root, text, found),
  /** `sourceDocPath`: the file a Save As started from, whose relative
   *  images are copied along. */
  migrateDraftImages: (
    docPath: string,
    srcs: string[],
    folder: string,
    sourceDocPath: string | null,
  ) => command("migrate_draft_images", docPath, srcs, folder, sourceDocPath),
  /** A file's bytes as base64, at a path the user picked (an export). */
  writeBase64File: (path: string, data: string): Promise<void> =>
    command("write_base64_file", path, data),
  writeTextFile: (path: string, contents: string): Promise<void> =>
    isFarUrl(path)
      ? farFiles(path).writeText(path, contents).finally(contentWritten)
      : command("write_text_file", path, contents),
};

/** A document saved in a far folder: plugins' view of it read again. */
function contentWritten(): void {
  if (!isIOSApp)
    void import("./far-plugin-fs").then((m) => m.contentFolderChanged());
}

/** A folder the backend can't read sets nothing: Textus's settings apply. */
const NO_CONVENTIONS: Generated.Conventions_Serialize = {
  sources: [],
  linkStyle: null,
  linkPath: null,
  linkRoot: null,
  updateLinks: null,
  attachments: null,
  softBreaks: null,
  templates: null,
  templateFormats: null,
  daily: null,
  weekly: null,
  monthly: null,
  newNotes: null,
  ignore: [],
  detected: null,
};

// Session and recents

export const session = {
  /** This window as the next launch brings it back. */
  updateWindow: (window: WindowSession_Deserialize) =>
    desktopQueryCommand("update_window_session", undefined, window),
  cancelQuit: () => desktopQueryCommand("cancel_session_quit", undefined),
  addRecentFile: (path: string) => command("add_recent_file", path),
  /** A folder opened in the sidebar, for File > Open Recent. */
  addRecentFolder: (path: string) =>
    desktopQueryCommand("add_recent_folder", undefined, path),
};

// Storage: settings, UI state and histories, held by Rust as JSON files.
// Only called when Rust booted this window; otherwise the stores use localStorage.

/** A settings snapshot and its revision. */
interface StoredSnapshot {
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
  /** Every conversation and memory, for a settings file. */
  aiRecordsExport: () => command("ai_records_export"),
  /** Adds a settings file's conversations and memories; nothing is replaced
   *  by an older copy, and no memory here is overwritten. */
  aiRecordsImport: (records: Generated.AiRecords) =>
    command("ai_records_import", records),
};

// Drafts

export const drafts = {
  saveDraftSnapshot: (
    tabId: string,
    path: string | null,
    content: string,
    diskMtime: number | null,
  ) => command("save_draft_snapshot", tabId, path, content, diskMtime),
  takeDraftSnapshots: () => command("take_draft_snapshots"),
  /** The taken drafts are back, kept again under their new tabs. */
  finishDraftRestore: () => command("finish_draft_restore"),
  clearDraftSnapshot: (tabId: string) => command("clear_draft_snapshot", tabId),
  clearAllDrafts: () => command("clear_all_drafts"),
  /** The page's tabs, kept by the app's process (reload-tabs.ts). */
  keepPageTabs: (text: string) => command("keep_page_tabs", text),
  keptPageTabs: () => command("kept_page_tabs"),
};

/** A document's undo history kept beside the app's data while its editor
 *  is let go, used when it opens at the same text again. */
export const undoFiles = {
  save: (path: string, hash: string, history: string) =>
    command("undo_file_save", path, hash, history),
  load: (path: string, hash: string) => command("undo_file_load", path, hash),
};

/** What is kept beside the app's data for a document or a folder's
 *  documents (notes, tracked changes, proposals, undo) follows a move. */
export const keptForDocuments = {
  move: (from: string, to: string) =>
    command("document_data_move", from, to, openFolderOnDisk()),
};

/** What the writer keeps on a document, as JSON: their notes (in its
 *  project's .textus/ when it is in one, this window's folder counting),
 *  or the changes they track. */
export const ownNotes = {
  read: (path: string, part: "notes" | "revisions") =>
    command("own_notes_read", path, part, openFolderOnDisk()),
  write: (path: string, part: "notes" | "revisions", value: string) =>
    command("own_notes_write", path, part, value, openFolderOnDisk()),
  /** The notes of `folder`'s documents still in the app's data, brought
   *  into it. */
  adopt: (folder: string) => command("own_notes_adopt", folder),
};

// A folder opened shares its documents' notes from then on.
onOpenFolder((folder) => void ownNotes.adopt(folder).catch(() => {}));
