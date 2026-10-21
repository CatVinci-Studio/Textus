import { Channel, invoke } from "@tauri-apps/api/core";
import { Update } from "@tauri-apps/plugin-updater";
import type { UpdateChannel } from "./update-channel";
import type {
  ChatHandoff,
  ChatHandoffState,
} from "../ai/chat/window/chat-bridge";
import type { DetachedTabDoc, HelpDoc } from "../document/doc-tabs";
import type { DirEntryInfo } from "./fs-types";
import type { ProviderCatalogEntry } from "../ai/provider-catalog";
import type { ImageModel, ImageProviderEntry } from "../ai/image-models";
import type {
  AgentSkill,
  AgentTurn,
  ChatAttachment,
  ImageAttachment,
  ThinkingLevel,
} from "../ai/types";
import type { GrammarIssue } from "../ai/writing/grammar-check-plugin";
import type { SkillCategory } from "../ai/skills/builtin";
import type { Lang } from "../i18n/langs";
import type { GalleryTheme } from "../theme/theme-gallery";
import type { AgentMode, ImageHost } from "../settings/SettingsContext";
import { isDesktopApp, isIOSApp } from "./capabilities";
import { iosFiles, isScopedUrl, newDocumentPath } from "./ios-files";
import { AI_OFF, aiRequestsAllowed } from "./ai-gate";

/**
 * Thin, typed wrappers around every Tauri command the frontend calls -
 * command names and their argument/return shapes live here once instead of
 * being repeated (and occasionally drifting) at each call site. This layer
 * intentionally does not change behavior: it's the same `invoke()` calls,
 * just typed and funneled through one error shape.
 *
 * Grouped by domain (fs, session, window, export, themes, auth, ai, cli) to
 * match the Rust command modules in src-tauri/src/.
 */

/** Wraps a rejected `invoke()` with the command name that failed, so a
 *  caught error can be logged/displayed without losing which call it was. */
export class IpcError extends Error {
  readonly command: string;
  readonly cause: unknown;
  constructor(command: string, cause: unknown) {
    super(
      `${command}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "IpcError";
    this.command = command;
    this.cause = cause;
  }
}

async function call<T>(command: string, args?: object): Promise<T> {
  try {
    return await invoke<T>(
      command,
      args as Record<string, unknown> | undefined,
    );
  } catch (err) {
    throw new IpcError(command, err);
  }
}

/**
 * A command that sends something to an AI service - a completion, a
 * grammar check, a conversation, a model list. While Textus AI is off it
 * is refused here, before it reaches Rust (which refuses it too). Every
 * entry point already checks the switch (settings/textus-ai.ts); this is
 * the backstop that keeps a missed one from making a request.
 */
function aiCall<T>(command: string, args?: object): Promise<T> {
  return aiRequestsAllowed()
    ? call<T>(command, args)
    : Promise.reject(new IpcError(command, AI_OFF));
}

/**
 * Commands that exist on desktop only - registered under `#[cfg(desktop)]`
 * in src-tauri/src/lib.rs, so on iOS there is nothing to call.
 *
 * Call sites already avoid these on iOS through src/platform/capabilities.ts;
 * this is the backstop that keeps a missed call site from reaching Rust.
 * `desktopQuery` answers with what the command would report when there is
 * nothing to report (no pending tab, no chat window, no windows) - safe for
 * reads and fire-and-forget bookkeeping. `desktopAction` rejects, for calls
 * whose caller needs to know nothing happened.
 */
function desktopQuery<T>(
  command: string,
  fallback: T,
  args?: object,
): Promise<T> {
  return isDesktopApp ? call<T>(command, args) : Promise.resolve(fallback);
}

function desktopAction<T>(command: string, args?: object): Promise<T> {
  return isDesktopApp
    ? call<T>(command, args)
    : Promise.reject(
        new IpcError(command, new Error("not available on this platform")),
      );
}

// ---------------------------------------------------------------------------
// fs (src-tauri/src/commands/fs.rs)
// ---------------------------------------------------------------------------

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

export interface FloatingDragArgs {
  tab: {
    path: string | null;
    content: string;
    savedContent: string;
    diskMtime: number | null;
    helpDoc: HelpDoc | null;
  };
  title: string;
  dirty: boolean;
  destroySource: boolean;
}

export interface WindowBounds {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

export const windowIpc = {
  takeDetachedTab: () =>
    desktopQuery<DetachedTabDoc | null>("take_detached_tab", null),
  listWindowBounds: () =>
    desktopQuery<WindowBounds[]>("list_window_bounds", []),
  startFloatingTabDrag: (args: FloatingDragArgs) =>
    desktopAction<void>("start_floating_tab_drag", args),
  startWindowDragTracking: () =>
    desktopQuery<boolean>("start_window_drag_tracking", false),
  takePendingShowHelp: () =>
    desktopQuery<string | null>("take_pending_show_help", null),
  /** The menu event this window was opened to carry out (Settings… or
   *  Open… chosen from the macOS menu bar with no window open), if any;
   *  asks once - the answer is taken. */
  takePendingMenuEvent: () =>
    desktopQuery<string | null>("take_pending_menu_event", null),
  /** The recent folder this window was opened to show (File > Open Recent
   *  with no window open), if any; asks once. */
  takePendingOpenFolder: () =>
    desktopQuery<string | null>("take_pending_open_folder", null),
  /** Opens files the way a file manager's open does: a window each, or
   *  tabs in the focused window in tab mode (lib.rs's open_paths). */
  openPaths: (paths: string[]) => desktopAction<void>("open_paths", { paths }),
  takePendingOpenPath: () => call<string | null>("take_pending_open_path"),
  takePendingOpenPaths: () => call<string[]>("take_pending_open_paths"),
  /** Pops the chat panel out into its own OS window; resolves to its label,
   *  which is the address every later message to it is sent to. One chat
   *  window per editor window, shared by its tabs. If one already serves
   *  this window, it is focused and its label returned - and
   *  `state` is parked for it to claim (CHAT_ADOPT_HANDOFF), so a second
   *  detach hands over its conversation and pending edits just like the
   *  first one did. */
  detachChatWindow: (args: {
    state: ChatHandoffState;
    position: [number, number] | null;
    title: string;
    pinned: boolean;
  }) => desktopAction<string>("detach_chat_window", args),
  takeChatHandoff: () =>
    desktopQuery<ChatHandoff | null>("take_chat_handoff", null),
  closeChatWindow: () => desktopQuery<void>("close_chat_window", undefined),
  /** Brings the chat window serving this editor to the front, handing it
   *  nothing; false when there is none. */
  focusChatWindow: () => desktopQuery<boolean>("focus_chat_window", false),
  /** The chat window serving THIS editor window, if any - re-read after a
   *  reload, or when Rust announces a chat window opened or closed. */
  currentChatWindow: () =>
    desktopQuery<string | null>("current_chat_window", null),
};

// ---------------------------------------------------------------------------
// menu (src-tauri/src/menu.rs) - only used where the app draws its own menu
// because the native bar is gone; see platform/window-chrome.ts.
// ---------------------------------------------------------------------------

export const menuIpc = {
  /** Runs a menu id exactly as clicking its native twin would. The ids come
   *  from app/app-menu-model.ts and are defined in src-tauri/src/menu.rs. */
  triggerMenuItem: (id: string) =>
    desktopQuery<void>("trigger_menu_item", undefined, { id }),
  /** Backs File > Open Recent, whose native submenu the app-drawn menu
   *  cannot read. */
  listRecentFiles: () => desktopQuery<string[]>("list_recent_files", []),
  /** The folders listed above the files there. */
  listRecentFolders: () => desktopQuery<string[]>("list_recent_folders", []),
  /** Rebuilds the native (macOS) menu bar with these labels, keyed as
   *  app/app-menu-model.ts's nativeMenuLabels keys them. */
  setMenuLabels: (labels: Record<string, string>) =>
    desktopQuery<void>("set_menu_labels", undefined, { labels }),
  /** Sets the native (macOS) View items' check marks, keyed by menu id
   *  (app/app-menu-model.ts's nativeMenuChecks). */
  setMenuChecks: (checks: Record<string, boolean>) =>
    desktopQuery<void>("set_menu_checks", undefined, { checks }),
  /** Sets the native (macOS) Format items' keys, keyed by menu id
   *  (app/app-menu-model.ts's nativeMenuAccelerators). */
  setMenuAccelerators: (accelerators: Record<string, string>) =>
    desktopQuery<void>("set_menu_accelerators", undefined, { accelerators }),
};

// ---------------------------------------------------------------------------
// export (src-tauri/src/commands/export.rs)
// ---------------------------------------------------------------------------

/** Our own pages, opened in the system browser. Each URL is fixed in Rust
 *  (commands/links.rs), not passed from here - except a link followed in a
 *  document, which Rust opens only if it is http(s) or mailto. */
export const links = {
  /** The website's community page, in the UI's language. */
  openCommunityPage: (language: Lang) =>
    call<void>("open_community_page", { language }),
  /** The website's video tutorials in the UI's language, at one lesson's
   *  clip (a TUTORIAL_CLIPS id, onboarding/tutorial-steps.ts) or, without
   *  one, from the top. */
  openTutorialsPage: (language: Lang, clip?: string) =>
    call<void>("open_tutorials_page", { language, clip: clip ?? null }),
  /** Settings › General › About Textus's links, and the theme gallery's
   *  website (Browse themes, when it can't be reached), by name. */
  openAboutLink: (page: "github" | "discord" | "qq" | "themes") =>
    call<void>("open_about_link", { page }),
  /** A web or mail link Ctrl/Cmd+clicked in a document
   *  (editor/markdown/link-click-plugin.ts). */
  openWebLink: (url: string) => call<void>("open_web_link", { url }),
};

export const exportDoc = {
  exportSaveDialog: (defaultName: string, filterName: string, ext: string) =>
    call<string | null>("export_save_dialog", { defaultName, filterName, ext }),
  detectPandoc: () => desktopQuery<string | null>("detect_pandoc", null),
  exportViaPandoc: (args: {
    pandocPath: string;
    markdown: string;
    outputPath: string;
    format: string;
    resourceDir: string | null;
    title: string;
  }) => desktopAction<void>("export_via_pandoc", args),
  openPandocInstallPage: () =>
    desktopQuery<void>("open_pandoc_install_page", undefined),
  /** Nothing to show the file in on iOS - resolves without doing anything. */
  revealInDir: (path: string) =>
    desktopQuery<void>("reveal_in_dir", undefined, { path }),
  // Renders the self-contained, already-paginated themed HTML offscreen and
  // writes the PDF straight to `path` - no print dialog on any platform
  // (WKWebView createPDF / WebView2 PrintToPdf / WebKitGTK print-to-file;
  // see export.rs). baseDir resolves relative images. pageNumbers stamps
  // each page's number on the finished file (pdf_page_numbers.rs).
  exportPdfNative: (args: {
    html: string;
    baseDir: string | null;
    outputPath: string;
    pageNumbers: boolean;
  }) => desktopAction<void>("export_pdf_native", args),
};

// ---------------------------------------------------------------------------
// themes (src-tauri/src/commands/themes.rs)
// ---------------------------------------------------------------------------

export const themes = {
  saveThemeCss: (id: string, variant: "light" | "dark", css: string) =>
    call<void>("save_theme_css", { id, variant, css }),
  loadThemeCss: (id: string, variant: "light" | "dark") =>
    call<string | null>("load_theme_css", { id, variant }),
  deleteTheme: (id: string) => call<void>("delete_theme", { id }),
};

/** The public theme gallery (src-tauri/src/commands/theme_gallery.rs). A
 *  file is named by its path in the gallery repository, never by URL. */
export const themeGallery = {
  catalog: () => call<GalleryTheme[]>("theme_gallery_catalog"),
  css: (path: string) => call<string>("theme_gallery_css", { path }),
  /** A screenshot, as a `data:` URL. */
  preview: (path: string) => call<string>("theme_gallery_preview", { path }),
};

// ---------------------------------------------------------------------------
// auth (src-tauri/src/auth/*.rs) - API keys, OAuth, custom endpoint
// ---------------------------------------------------------------------------

export interface OauthStatus {
  configured: boolean;
}

/** What custom_endpoint_status reports (src-tauri/src/auth/custom_endpoint.rs
 *  CustomEndpointStatus). The key itself never comes back to the webview -
 *  `api_key` is always null - only whether one is stored. */
export interface CustomEndpointConfig {
  base_url: string;
  api_key: string | null;
  /** A key is saved for `base_url`: saving or testing with the key field
   *  left empty uses it (for that URL only), and Clear removes it. */
  has_api_key: boolean;
  model: string;
}

/** Provider ids with an OAuth flow and their command names - dynamic
 *  dispatch (not a fixed per-provider function) because the picker iterates
 *  the catalog and looks these up by provider id. */
const OAUTH_COMMANDS: Record<
  string,
  { status: string; login: string; logout: string }
> = {
  openai: {
    status: "codex_auth_status",
    login: "codex_login",
    logout: "codex_logout",
  },
  anthropic: {
    status: "claude_auth_status",
    login: "claude_login",
    logout: "claude_logout",
  },
};

export const auth = {
  oauthStatus: (providerId: string) =>
    call<OauthStatus>(OAUTH_COMMANDS[providerId].status),
  /** Signs in through the browser. `onUrl` gets the sign-in page's URL as
   *  the browser is asked to open it, for when it doesn't open. */
  oauthLogin: (providerId: string, onUrl?: (url: string) => void) => {
    const channel = new Channel<string>();
    if (onUrl) channel.onmessage = onUrl;
    return call<OauthStatus>(OAUTH_COMMANDS[providerId].login, {
      onUrl: channel,
    });
  },
  oauthLogout: (providerId: string) =>
    call<void>(OAUTH_COMMANDS[providerId].logout),

  providerApiKeyStatus: (provider: string) =>
    call<boolean>("provider_api_key_status", { provider }),
  setProviderApiKey: (provider: string, key: string) =>
    call<void>("set_provider_api_key", { provider, key }),
  clearProviderApiKey: (provider: string) =>
    call<void>("clear_provider_api_key", { provider }),

  customEndpointStatus: () =>
    call<CustomEndpointConfig | null>("custom_endpoint_status"),
  setCustomEndpoint: (baseUrl: string, apiKey: string | null, model: string) =>
    call<void>("set_custom_endpoint", { baseUrl, apiKey, model }),
  clearCustomEndpoint: () => call<void>("clear_custom_endpoint"),
  fetchCustomModels: (baseUrl: string, apiKey: string | null) =>
    aiCall<string[]>("fetch_custom_models", { baseUrl, apiKey }),
  testCustomEndpoint: (baseUrl: string, apiKey: string | null) =>
    aiCall<void>("test_custom_endpoint", { baseUrl, apiKey }),
};

/** Image-host credentials reuse the same private 0600 credential store as
 * provider keys, one per host under a reserved id that is never shown as
 * an AI provider. Mirrors `ImageHost::credential_id` in
 * src-tauri/src/commands/image_host.rs. */
const IMAGE_HOST_CREDENTIAL_IDS: Record<ImageHost, string> = {
  picgo: "__image_host_picgo",
  smms: "__image_host_smms",
  imgur: "__image_host_imgur",
  custom: "__image_host",
};
export const imageHostAuth = {
  tokenStatus: (host: ImageHost) =>
    auth.providerApiKeyStatus(IMAGE_HOST_CREDENTIAL_IDS[host]),
  setToken: (host: ImageHost, token: string) =>
    auth.setProviderApiKey(IMAGE_HOST_CREDENTIAL_IDS[host], token),
  clearToken: (host: ImageHost) =>
    auth.clearProviderApiKey(IMAGE_HOST_CREDENTIAL_IDS[host]),
};

// ---------------------------------------------------------------------------
// ai (src-tauri/src/ai/*.rs)
// ---------------------------------------------------------------------------

/// Mirrors ai::cancel::CANCELLED - the error string ai_agent_message rejects
/// with when a stop() call won the race against the in-flight request. Not a
/// real failure, so callers should treat it differently from other errors.
export const AI_CANCELLED = "cancelled";

/** A picture waiting for a decision. Mirrors `GeneratedImageData` in
 *  src-tauri/src/ai/images.rs. */
export interface GeneratedImageData {
  mime: string;
  ext: string;
  dataBase64: string;
}

/** Mirrors `WebSearchStatus` in src-tauri/src/ai/web/mod.rs. */
export interface WebSearchStatus {
  /** The provider searches by itself. */
  native: boolean;
  /** Otherwise, the search service Textus's web_search uses; null when
   *  none is set up. */
  service: string | null;
}

/** One live fragment of an in-flight ai_agent_message, delivered over a
 *  Tauri channel while the agent loop runs. Purely additive display data -
 *  the command still resolves with the complete turn list, which stays the
 *  authoritative result. Mirrors `StreamEvent` in src-tauri/src/ai/agent.rs;
 *  the two must stay in sync. */
export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "toolStart"; callId: string; name: string }
  | { type: "toolArgsDelta"; callId: string; delta: string }
  | { type: "turn"; turn: AgentTurn }
  /** The step being streamed came back garbled and is asked for again:
   *  drop what it streamed. */
  | { type: "retry" }
  /** The model is thinking: a fragment of its reasoning, or "" where the
   *  provider only says that it thinks. Never part of the reply. */
  | { type: "thinking"; text: string };

/** Where the cursor sits, beyond the raw text around it - what lets a
 *  completion fit the document instead of guessing from 2000 characters.
 *  Mirrors CompletionHints in src-tauri/src/ai/client.rs. */
export interface CompletionHints {
  /** The document's first heading, when it has one. */
  title: string | null;
  /** Headings enclosing the cursor, outermost first. */
  section: string[];
  /** What the cursor is in: "paragraph", "heading", "list item", ... */
  block: string;
  /** "short" for the as-you-type nudge, "long" for an explicit request. */
  length: "short" | "long";
  /** How many alternatives to write (the manual trigger asks for three). */
  candidates?: number;
  /** The context's prose - its text without code blocks, diagram and math
   *  source - which the backend reads the language from. */
  prose?: string;
  /** The app's language, for when the prose is too short to tell. */
  uiLanguage?: string | null;
}

/** A project library entry (`.textus/library/*.md`, ai::project). */
export interface LibraryEntry {
  name: string;
  aliases: string[];
  include: "always" | "detected" | "never";
  /** Relative to the project root. */
  file: string;
  body: string;
  /** Set on an entry Textus AI wrote (ai::memory) - also listed under "AI
   *  remembered". */
  remembered: Remembered | null;
}

/** Where and when Textus AI remembered something - `Remembered` in
 *  src-tauri/src/ai/memory.rs. */
export interface Remembered {
  created: string;
  updated: string;
  conversation: string | null;
  title: string | null;
  document: string | null;
}

/** One thing Textus AI remembered by itself - `Memory` in ai/memory.rs.
 *  `id` is `<scope>/memory/<file stem>`. */
export interface Memory {
  id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  text: string;
  /** Absolute path, for Edit. */
  file: string;
  remembered: Remembered;
  /** Whether it fits the prompt's budget and so goes with requests. */
  included: boolean;
}

export type MemoryScope = "project" | "personal";
/** `MemoryKind` in ai/memory.rs. */
export type MemoryKind = "requirement" | "preference" | "style";

/** Every memory for a document, personal first - `Memories` in
 *  ai/memory.rs. `chars` of the included ones, of `cap`. */
export interface Memories {
  items: Memory[];
  chars: number;
  cap: number;
}

/** Which library entries reached Textus AI - `LibraryUse` in
 *  ai/project.rs: the entries' `file`s, those that came up but didn't fit,
 *  and whether that was the last request (or the document's text alone,
 *  before any). */
export interface LibraryUse {
  included: string[];
  leftOut: string[];
  lastRequest: boolean;
  /** The limit per request, in characters. */
  cap: number;
}

/** What shapes Textus AI for one document - see docs/design/ai-concepts.md. */
export interface AgentWorkspaceInfo {
  /** The global writing instructions (agent.md), comments stripped. */
  instructions: string[];
  /** The project's writing instructions (.textus/agent.md), if any. */
  project_instructions: string | null;
  /** Global and project skills; a project skill replaces a global one of
   *  the same name. */
  skills: AgentSkill[];
  /** The project folder; null for an unsaved draft or a folder too broad
   *  to expose (home, a drive root). */
  root: string | null;
  style: string | null;
  library: LibraryEntry[];
  /** What the style profile's front matter sets for the writing
   *  conventions (`conventions:` and option keys) - ai::rules::profile. */
  conventions?: ProjectConventions;
  /** What Textus AI remembered by itself, personal and the project's. */
  memories: Memories;
  /** Settings > Textus AI > Remember automatically. */
  remember: boolean;
  /** The project has a Levis project's `.levis/` with files `.textus/`
   *  lacks - offered for conversion (ai::levis_project). */
  levis_project: boolean;
}

// ---------------------------------------------------------------------------
// Writing conventions (src-tauri/src/ai/rules/profile.rs)

/** The settings.json key of the global writing conventions default. No
 *  frontend code reads it, but keep it: profile.rs's tests check it against
 *  the key the backend uses. */
export const WRITING_CONVENTIONS_KEY = "writingConventions";
/** Its default value, and the per-language value meaning "no choice". */
export const WRITING_CONVENTIONS_AUTOMATIC = "automatic";

/** A document language as the rules engine names it. */
export type ConventionsLang =
  "zh-Hans" | "zh-Hant" | "en" | "ja" | "ko" | "es" | "fr" | "de" | "ru" | "pt";

/**
 * The profiles each language offers, the first entry being the one
 * Automatic uses (null: no national norm - universal rules and consistency
 * checks only). Mirrors LANGUAGE_PROFILES in src-tauri/src/ai/rules/profile.rs
 * (a Rust test keeps them the same); `writingConventionsOptions()` returns
 * the same data from Rust, with the option keys.
 */
export const WRITING_CONVENTIONS: Record<
  ConventionsLang,
  { automatic: string | null; profiles: string[] }
> = {
  "zh-Hans": {
    automatic: "zh-Hans-CN",
    profiles: [
      "zh-Hans-CN",
      "zh-Hans-CN/tech",
      "zh-Hans-CN/gongwen",
      "zh-Hans-CN/academic",
      "zh-Hans-CN/fiction",
      "zh-Hans-CN/newmedia",
      "zh-Hant-CN",
    ],
  },
  "zh-Hant": {
    automatic: "zh-Hant-TW",
    profiles: ["zh-Hant-TW", "zh-Hant-TW/gongwen", "zh-Hant-HK"],
  },
  en: {
    automatic: null,
    profiles: [
      "en-US/general",
      "en-US/news",
      "en-US/tech-google",
      "en-US/tech-microsoft",
      "en-US/apa",
      "en-US/mla",
      "en-GB/govuk",
      "en-GB/oxford",
      "en-US/army",
      "en-AU",
    ],
  },
  ja: {
    automatic: "ja/jtf",
    profiles: ["ja/jtf", "ja/koyobun", "ja/fiction", "ja/tech"],
  },
  ko: { automatic: "ko", profiles: ["ko", "ko/official"] },
  es: { automatic: null, profiles: ["es-ES", "es-419", "es/eu"] },
  fr: { automatic: null, profiles: ["fr-FR", "fr-CA", "fr-CH", "fr/eu"] },
  de: {
    automatic: null,
    profiles: ["de-DE", "de-DE/din5008", "de-AT", "de-CH", "de/eu"],
  },
  ru: { automatic: "ru", profiles: ["ru", "ru/gost"] },
  pt: {
    automatic: "pt-BR",
    profiles: ["pt-BR", "pt-BR/official", "pt-PT", "pt/eu"],
  },
};

/**
 * The stored setting: "automatic", one profile (what the Settings row
 * stores - it applies to documents in that profile's language), or a
 * profile per language (a language left out, or set to "automatic", stays
 * Automatic), with optional option keys (`cjk-latin-space`, `quotes`,
 * `fr.spacing`...).
 */
export type WritingConventionsSetting =
  | typeof WRITING_CONVENTIONS_AUTOMATIC
  | string
  | ({ [lang in ConventionsLang]?: string } & {
      options?: Record<string, string>;
    });

/** `.textus/style.md` front matter, as Rust read it. */
export interface ProjectConventions {
  profiles: string[];
  options: Record<string, string>;
}

/** A resolved profile (rules::Profile). */
export interface ConventionsProfile {
  id: string;
  lang: ConventionsLang;
  region: string | null;
  preset: string | null;
  /** Chosen by the user (settings or project) rather than Automatic. */
  explicit: boolean;
  source: "automatic" | "settings" | "project";
  options: Record<string, string>;
}

export interface WritingConventionsOptions {
  settingKey: string;
  automatic: string;
  languages: {
    lang: ConventionsLang;
    automaticProfile: string | null;
    profiles: string[];
  }[];
  options: { key: string; values: string[] }[];
}

export interface EffectiveConventions {
  lang: ConventionsLang | null;
  profile: ConventionsProfile | null;
  byLanguage: ConventionsProfile[];
}

/** One finding of the rules engine (rules::Finding). */
export interface ConventionsFinding {
  rule: string;
  /** Unicode-scalar offsets into the checked Markdown. */
  start: number;
  end: number;
  original: string;
  /** Null when the finding only flags. */
  suggestion: string | null;
  severity: "error" | "warning" | "info";
  /** "safe": fine to apply without review ("fix all"). */
  fix: "safe" | "suggest" | "none";
  priority: "P0" | "P1" | "P2";
  /** In the language of the text it fired on. */
  message: string;
  /** 1-based line. */
  line?: number;
}

export interface ConventionsReport {
  lang: ConventionsLang | null;
  profile: ConventionsProfile | null;
  findings: ConventionsFinding[];
}

/** An exact platform count (rules::measure). */
export interface TextMeasure {
  metric: string;
  count: number;
  limit: number | null;
  unit: string;
  within: boolean;
  notes: string[];
}

/**
 * One skill as the `/` menu and Settings list it (ai::workspace::AgentSkill,
 * from `list_skills`): the built-ins, the global config folder's skills/
 * and the project's .textus/skills/, each layer replacing same-named skills
 * of the layers before it. Hidden skills are never listed.
 */
export interface SkillListItem {
  /** Canonical, ASCII kebab-case for a built-in; what follows the `/`. */
  name: string;
  description: string;
  /** The body sent to the model (comments stripped, packs not in it). */
  prompt?: string;
  /** The `/` menu's group; null for a user skill that doesn't say. */
  category: SkillCategory | null;
  /** "userOnly": offered in the `/` menu but never picked up by the model
   *  on its own. */
  invocation: "both" | "userOnly" | "hidden";
  source: "builtin" | "global" | "project";
  /** A global or project skill with a built-in's name - a copy made by
   *  Customize… (`basedOn` set), or the user's own skill that happens to
   *  share it. */
  overridesBuiltin: boolean;
  /** False for a built-in turned off in Settings, and for a copy of one
   *  made by Customize… (it stays listed so Settings can turn it back on;
   *  the `/` menu leaves it out). */
  enabled: boolean;
  /** Extra words typed after `/` for it, by UI language code. */
  aliases: Record<string, string[]>;
  /** Reference-pack sections Rust appends when it is used. */
  packs?: string[];
  /** A built-in's `textus-version`. */
  version?: string | null;
  /** "tighten@1" on a copy made by Customize… - only then can Reset
   *  delete it. */
  basedOn?: string | null;
  /** That copy is older than the bundled built-in. */
  builtinUpdated?: boolean;
}

export const ai = {
  listProviders: () => call<ProviderCatalogEntry[]>("list_providers"),
  /** Whether Deep thinking changes anything for this provider and Agent
   *  model (null: the provider's default) - ai_can_think_deeper in
   *  src-tauri/src/ai/catalog.rs. */
  canThinkDeeper: (provider: string, model: string | null) =>
    call<boolean>("ai_can_think_deeper", { provider, model }),
  /** The services Settings › Textus AI › Image model offers (ai/images.rs). */
  listImageProviders: () => call<ImageProviderEntry[]>("list_image_providers"),
  /** A picture generate_image made, waiting for Accept or Reject. */
  generatedImage: (id: string) =>
    call<GeneratedImageData>("ai_generated_image", { id }),
  /** Lets a waiting picture go: rejected, or saved. */
  discardGeneratedImage: (id: string) =>
    call<void>("ai_discard_generated_image", { id }),
  fetchAgentModels: (provider: string) =>
    aiCall<string[]>("fetch_agent_models", { provider }),
  setAiProxy: (proxy: string | null) => call<void>("set_ai_proxy", { proxy }),
  complete: (
    provider: string,
    before: string,
    after: string,
    style: string | null,
    model: string | null,
    hints: CompletionHints | null = null,
    /** Resolve the project folder whose style profile and library the
     *  completion follows (src-tauri ai::project). */
    project: { docPath: string | null; workspaceRoot: string | null } = {
      docPath: null,
      workspaceRoot: null,
    },
  ) =>
    aiCall<string>("ai_complete", {
      provider,
      before,
      after,
      style,
      model,
      hints,
      docPath: project.docPath,
      workspaceRoot: project.workspaceRoot,
    }),
  grammarCheck: (
    provider: string,
    paragraph: string,
    strictness: string | null,
    model: string | null,
    /** The document's project, for its writing conventions profile and
     *  library names; omitted, the check uses the global setting. */
    project: { docPath: string | null; workspaceRoot: string | null } = {
      docPath: null,
      workspaceRoot: null,
    },
    /** The app's language: the explanations are written in it. */
    uiLanguage: string | null = null,
  ) =>
    aiCall<GrammarIssue[]>("ai_grammar_check", {
      provider,
      paragraph,
      strictness,
      model,
      docPath: project.docPath,
      workspaceRoot: project.workspaceRoot,
      uiLanguage,
    }),
  agentMessage: ({
    onEvent,
    ...args
  }: {
    provider: string;
    document: string;
    docPath: string | null;
    /** The chosen project folder (Settings > Textus AI > Project Folder, or
     *  the project bar); null keeps the default, the document's own folder.
     *  Decides where .textus/ is read from and how far list_files/read_file
     *  may reach. */
    workspaceRoot: string | null;
    history: AgentTurn[];
    message: string;
    /** Attached images. Text-shaped attachments were already extracted and
     *  inlined into `message` by the caller. */
    images: ImageAttachment[];
    webSearch: boolean;
    /** How hard the model thinks; left out, the provider's default. */
    thinking?: ThinkingLevel;
    /** Settings > Search service and the SearXNG address: what web_search
     *  uses when the model can't search by itself (ai/web/mod.rs). */
    searchService?: string;
    searxngUrl?: string;
    mode: AgentMode;
    model: string | null;
    requestId: string;
    /** Heading of the section the cursor/selection is in - embedded in full
     *  when the document is too long to send whole (agent.rs). */
    focusHeading?: string | null;
    /** The UI language: the agent is given that UI's names for the app's
     *  concepts and controls (agent.rs, UiNames). */
    uiLanguage?: string;
    /** The conversation, recorded with what Textus AI remembers in it
     *  (`Source` in ai/memory.rs). */
    conversation?: { id: string; title: string };
    /** The image model, or null for none: generate_image is offered
     *  only with one (ai/images.rs). */
    imageModel?: ImageModel | null;
    /** Live fragments while the request runs - see StreamEvent. */
    onEvent?: (event: StreamEvent) => void;
  }) => {
    const channel = new Channel<StreamEvent>();
    if (onEvent) channel.onmessage = onEvent;
    return aiCall<AgentTurn[]>("ai_agent_message", {
      ...args,
      onEvent: channel,
    });
  },
  /** What the Web search button can do with this provider and model: its
   *  own search, or the search service Textus would use instead (none: it
   *  needs one set up). */
  webSearchStatus: (
    provider: string,
    model: string | null,
    searchService: string,
    searxngUrl: string,
  ) =>
    call<WebSearchStatus>("web_search_status", {
      provider,
      model,
      searchService,
      searxngUrl,
    }),
  cancelAgentMessage: (requestId: string) =>
    call<void>("ai_cancel", { requestId }),

  loadAgentWorkspace: (docPath: string | null, rootOverride: string | null) =>
    call<AgentWorkspaceInfo>("load_agent_workspace", { docPath, rootOverride }),
  /** The writing conventions setting's allowed values (ai::conventions). */
  writingConventionsOptions: () =>
    call<WritingConventionsOptions>("writing_conventions_options"),
  /** The profile a document follows, and each language's in its project. */
  writingConventionsEffective: (
    docPath: string | null,
    workspaceRoot: string | null,
    document: string | null = null,
  ) =>
    call<EffectiveConventions>("writing_conventions_effective", {
      docPath,
      workspaceRoot,
      document,
    }),
  /** Checks a document's writing conventions offline (no AI provider). */
  checkConventions: (
    document: string,
    docPath: string | null,
    workspaceRoot: string | null,
    strictness: string | null = null,
  ) =>
    call<ConventionsReport>("conventions_check_document", {
      document,
      docPath,
      workspaceRoot,
      strictness,
    }),
  /** Exact platform counts: "x_weighted", "bluesky", "wechat_title"... */
  measureText: (text: string, metric: string) =>
    call<TextMeasure | null>("measure_text", { text, metric }),
  /** The project folder's text files, for @-mentions (ai::project). */
  listProjectFiles: (docPath: string | null, workspaceRoot: string | null) =>
    call<string[]>("list_project_files", { docPath, workspaceRoot }),
  readProjectFile: (
    docPath: string | null,
    workspaceRoot: string | null,
    path: string,
  ) => call<string>("read_project_file", { docPath, workspaceRoot, path }),
  /** Creates `.textus/<rel>` from `template` if missing; returns its path. */
  ensureProjectFile: (
    docPath: string | null,
    workspaceRoot: string | null,
    rel: string,
    template: string,
  ) =>
    call<string>("ensure_project_file", {
      docPath,
      workspaceRoot,
      rel,
      template,
    }),
  pickTextFiles: () => call<string[]>("pick_text_files"),
  /** Undoes a remember call (ai::memory): deletes what it created, or
   *  writes back `previous`, the file before it updated it. */
  memoryUndo: (
    docPath: string | null,
    workspaceRoot: string | null,
    id: string,
    previous: string | null,
  ) => call<void>("memory_undo", { docPath, workspaceRoot, id, previous }),
  /** Moves a memory to the other scope; returns its new id. */
  memoryMove: (
    docPath: string | null,
    workspaceRoot: string | null,
    id: string,
    scope: MemoryScope,
  ) => call<string>("memory_move", { docPath, workspaceRoot, id, scope }),
  /** Deletes a memory or a library entry (`project/library/<stem>`). */
  memoryDelete: (
    docPath: string | null,
    workspaceRoot: string | null,
    id: string,
  ) => call<void>("memory_delete", { docPath, workspaceRoot, id }),
  /** Saves one memory the user asked for with a click (a suggestion
   *  learned from revision choices); returns its id. Fails with plain
   *  words, as the remember tool does, on a duplicate. */
  memoryRemember: (
    docPath: string | null,
    workspaceRoot: string | null,
    kind: MemoryKind,
    scope: MemoryScope,
    text: string,
  ) =>
    call<{ remembered: string; scope: MemoryScope }>("memory_remember", {
      docPath,
      workspaceRoot,
      kind,
      scope,
      text,
    }),
  /** The revision choices log (ai/revision/revision-learning.ts), kept
   *  beside the personal memories and never sent anywhere; null when
   *  there is none yet. */
  revisionChoicesRead: () => call<unknown>("revision_choices_read"),
  revisionChoicesWrite: (log: object) =>
    call<void>("revision_choices_write", { log }),
  /** The library entries the last request for the document carried. */
  libraryUse: (
    docPath: string | null,
    workspaceRoot: string | null,
    document: string,
  ) => call<LibraryUse>("library_use", { docPath, workspaceRoot, document }),
  /** Copies a Levis project's `.levis/` into `.textus/` (never moves or
   *  deletes it); returns how many files were copied. */
  convertLevisProject: (docPath: string | null, workspaceRoot: string | null) =>
    call<number>("convert_levis_project", { docPath, workspaceRoot }),
  /** "Learn my style": writes the project's .textus/style.md from the
   *  picked samples and returns its path. */
  learnStyle: (args: {
    provider: string;
    model: string | null;
    docPath: string | null;
    workspaceRoot: string | null;
    files: string[];
  }) => aiCall<string>("learn_style", args),
  /** Folder picker behind "Choose project folder…" (the project bar's menu
   *  and Settings > Textus AI > Project Folder). */
  pickWorkspaceRoot: (): Promise<string | null> =>
    isIOSApp
      ? iosFiles.pickProjectFolder()
      : desktopQuery<string | null>("pick_workspace_root", null),
  /** Reveals the global config folder, creating it - with `template` as
   *  its agent.md - on first use. */
  openGlobalAgentDir: (template: string) =>
    desktopAction<void>("open_global_agent_dir", { template }),
  /** The global agent.md's path, created from `template` if missing. */
  ensureGlobalAgentMd: (template: string) =>
    call<string>("ensure_global_agent_md", { template }),
  importAgentSkill: () => call<AgentSkill[] | null>("import_agent_skill"),
  /** Every skill for this document - built-in, global and project - with
   *  the turned-off built-ins still in (`enabled: false`). Both null: the
   *  built-ins and the global ones, as Settings shows them. */
  listSkills: (docPath: string | null, workspaceRoot: string | null) =>
    call<SkillListItem[]>("list_skills", { docPath, workspaceRoot }),
  /** Copies a built-in into the global config folder's skills/ (or finds
   *  the copy already there) and returns its path, to open in a tab. */
  customizeBuiltinSkill: (name: string) =>
    call<string>("customize_builtin_skill", { name }),
  /** Deletes the copy Customize… made, so the built-in applies again;
   *  returns the deleted files' paths (a tab showing one is closed). */
  resetBuiltinSkill: (name: string) =>
    call<string[]>("reset_builtin_skill", { name }),
  setBuiltinSkillEnabled: (name: string, enabled: boolean) =>
    call<string[]>("set_builtin_skill_enabled", { name, enabled }),
  pickAttachmentFile: () => call<ChatAttachment | null>("pick_attachment_file"),
};

// ---------------------------------------------------------------------------
// cli (src-tauri/src/commands/cli.rs)
// ---------------------------------------------------------------------------

export const cli = {
  cliCommandStatus: () => desktopQuery<boolean>("cli_command_status", false),
  installCliCommand: () => desktopAction<void>("install_cli_command"),
};

// ---------------------------------------------------------------------------
// background mode (src-tauri/src/background/) - desktop only
// ---------------------------------------------------------------------------

/** Rust -> every window: the tray changed. Mirrors STATUS_EVENT and
 *  `Status` in background/mod.rs - change both. */
export const BACKGROUND_STATUS = "background-status";
export interface BackgroundStatus {
  /** "unavailable": Linux without libayatana-appindicator (or
   *  libappindicator); the process still stays in the background. */
  tray: "off" | "on" | "unavailable";
}

export const background = {
  status: () =>
    desktopQuery<BackgroundStatus | null>("background_status", null),
};

// ---------------------------------------------------------------------------
// default editor (src-tauri/src/commands/default_editor.rs) - desktop only
// ---------------------------------------------------------------------------

/** Mirrors `DefaultEditorStatus` in default_editor.rs - change both. */
export interface DefaultEditorStatus {
  /** False where this installation can't be the default (an AppImage). */
  supported: boolean;
  isDefault: boolean;
  /** The choice is the user's, made in the system's settings, which
   *  `set` opens (Windows). */
  chooseInSettings: boolean;
}

export const defaultEditor = {
  status: () =>
    desktopQuery<DefaultEditorStatus | null>("default_editor_status", null),
  set: () => desktopAction<void>("set_default_editor"),
};

// ---------------------------------------------------------------------------
// distribution (src-tauri/src/distribution.rs)
// ---------------------------------------------------------------------------

/** The channel this build was installed through - see distribution.rs. */
export type Distribution = "direct" | "homebrew" | "aur";

export const distribution = {
  appDistribution: () => call<Distribution>("app_distribution"),
};

// ---------------------------------------------------------------------------
// update (src-tauri/src/commands/update.rs) - desktop only
// ---------------------------------------------------------------------------

export type { UpdateChannel } from "./update-channel";

/** Mirrors UpdateMetadata in src-tauri/src/commands/update.rs, which is the
 *  plugin's own check answer. */
type UpdateMetadata = ConstructorParameters<typeof Update>[0];

export const updater = {
  /** The plugin's `check()` on `channel`'s endpoints; the `Update` it
   *  answers downloads and installs through the plugin as usual. */
  check: async (channel: UpdateChannel): Promise<Update | null> => {
    const metadata = await desktopQuery<UpdateMetadata | null>(
      "check_for_update",
      null,
      { channel },
    );
    return metadata ? new Update(metadata) : null;
  },
};

// ---------------------------------------------------------------------------
// drafts (src-tauri/src/commands/drafts.rs) - best-effort autosave for
// unsaved content (draft-autosave.ts).
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
