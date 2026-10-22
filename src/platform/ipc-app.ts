import { Update } from "@tauri-apps/plugin-updater";
import type { UpdateChannel } from "./update-channel";
import type {
  ChatHandoff,
  ChatHandoffState,
} from "../ai/chat/window/chat-bridge";
import type { DetachedTabDoc, HelpDoc } from "../document/doc-tabs";
import type { Lang } from "../i18n/langs";
import type { GalleryTheme } from "../theme/theme-gallery";
import { call, desktopAction, desktopQuery } from "./ipc-call";

/**
 * Backend commands for the app around the document: windows, the menu
 * bar, links, export, themes, the command line, background mode, the
 * default editor, how the app was installed and its updates (ipc.ts).
 */

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

/** Mirrors UpdateMetadata in src-tauri/src/commands/update.rs, which is the
 *  plugin's own check answer. */
export type UpdateMetadata = ConstructorParameters<typeof Update>[0];

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
