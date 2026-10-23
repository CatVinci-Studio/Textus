import { Update } from "@tauri-apps/plugin-updater";
import type { UpdateChannel } from "./update-channel";
import type {
  ChatHandoff,
  ChatHandoffState,
} from "../ai/chat/window/chat-bridge";
import type { DetachedTabDoc, HelpDoc } from "../document/doc-tabs";
import type { Lang } from "../i18n/langs";
import type * as Generated from "./bindings/app";
import {
  command,
  desktopAction,
  desktopActionCommand,
  desktopQueryCommand,
} from "./ipc-call";

/**
 * Backend commands for the app around the document: windows, the menu
 * bar, links, export, themes, the command line, background mode, the
 * default editor, how the app was installed and its updates (ipc.ts).
 */

export interface FloatingDragArgs {
  tab: Generated.DetachedTab_Deserialize & { helpDoc: HelpDoc | null };
  title: string;
  dirty: boolean;
  destroySource: boolean;
}

export type { WindowBounds } from "./bindings/app";

export const windowIpc = {
  // Rust carries a tab's help guide as a string; it is one of the
  // frontend's HelpDoc ids, which is what went in.
  takeDetachedTab: () =>
    desktopQueryCommand(
      "take_detached_tab",
      null,
    ) as Promise<DetachedTabDoc | null>,
  listWindowBounds: () => desktopQueryCommand("list_window_bounds", []),
  startFloatingTabDrag: ({
    tab,
    title,
    dirty,
    destroySource,
  }: FloatingDragArgs) =>
    desktopActionCommand(
      "start_floating_tab_drag",
      tab,
      title,
      dirty,
      destroySource,
    ),
  startWindowDragTracking: () =>
    desktopQueryCommand("start_window_drag_tracking", false),
  takePendingShowHelp: () =>
    desktopQueryCommand("take_pending_show_help", null),
  /** The menu event this window was opened to carry out (Settings… or
   *  Open… chosen from the macOS menu bar with no window open), if any;
   *  asks once - the answer is taken. */
  takePendingMenuEvent: () =>
    desktopQueryCommand("take_pending_menu_event", null),
  /** The recent folder this window was opened to show (File > Open Recent
   *  with no window open), if any; asks once. */
  takePendingOpenFolder: () =>
    desktopQueryCommand("take_pending_open_folder", null),
  /** Opens files the way a file manager's open does: a window each, or
   *  tabs in the focused window in tab mode (lib.rs's open_paths). */
  openPaths: (paths: string[]) => desktopActionCommand("open_paths", paths),
  /** One file in a window of its own, tab mode or not (#348). */
  openPathInNewWindow: (path: string) =>
    desktopActionCommand("open_path_in_new_window", path),
  takePendingOpenPath: () => command("take_pending_open_path"),
  takePendingOpenPaths: () => command("take_pending_open_paths"),
  /** Pops the chat panel out into its own OS window; resolves to its label,
   *  which is the address every later message to it is sent to. One chat
   *  window per editor window, shared by its tabs. If one already serves
   *  this window, it is focused and its label returned - and
   *  `state` is parked for it to claim (CHAT_ADOPT_HANDOFF), so a second
   *  detach hands over its conversation and pending edits just like the
   *  first one did. The state is the chat window's own, opaque JSON to
   *  Rust. */
  detachChatWindow: (args: {
    state: ChatHandoffState;
    position: [number, number] | null;
    title: string;
    pinned: boolean;
    // Rust reads these keys as one struct (commands/args.rs), which the
    // generated bindings can't type: checked by hand, as before.
  }) => desktopAction<string>("detach_chat_window", args),
  takeChatHandoff: () =>
    desktopQueryCommand(
      "take_chat_handoff",
      null,
    ) as Promise<ChatHandoff | null>,
  closeChatWindow: () => desktopQueryCommand("close_chat_window", undefined),
  /** Brings the chat window serving this editor to the front, handing it
   *  nothing; false when there is none. */
  focusChatWindow: () => desktopQueryCommand("focus_chat_window", false),
  /** The chat window serving THIS editor window, if any - re-read after a
   *  reload, or when Rust announces a chat window opened or closed. */
  currentChatWindow: () => desktopQueryCommand("current_chat_window", null),
};

// ---------------------------------------------------------------------------
// menu (src-tauri/src/menu.rs) - only used where the app draws its own menu
// because the native bar is gone; see platform/window-chrome.ts.
// ---------------------------------------------------------------------------

export const menuIpc = {
  /** Runs a menu id exactly as clicking its native twin would. The ids come
   *  from app/app-menu-model.ts and are defined in src-tauri/src/menu.rs. */
  triggerMenuItem: (id: string) =>
    desktopQueryCommand("trigger_menu_item", undefined, id),
  /** Backs File > Open Recent, whose native submenu the app-drawn menu
   *  cannot read. */
  listRecentFiles: () => desktopQueryCommand("list_recent_files", []),
  /** The folders listed above the files there. */
  listRecentFolders: () => desktopQueryCommand("list_recent_folders", []),
  /** Rebuilds the native (macOS) menu bar with these labels, keyed as
   *  app/app-menu-model.ts's nativeMenuLabels keys them. */
  setMenuLabels: (labels: Record<string, string>) =>
    desktopQueryCommand("set_menu_labels", undefined, labels),
  /** Sets the native (macOS) View items' check marks, keyed by menu id
   *  (app/app-menu-model.ts's nativeMenuChecks). */
  setMenuChecks: (checks: Record<string, boolean>) =>
    desktopQueryCommand("set_menu_checks", undefined, checks),
  /** Sets the native (macOS) Format items' keys, keyed by menu id
   *  (app/app-menu-model.ts's nativeMenuAccelerators). */
  setMenuAccelerators: (accelerators: Record<string, string>) =>
    desktopQueryCommand("set_menu_accelerators", undefined, accelerators),
  /** Fills the native Plugins menu with what the plugins that are on put
   *  there (menu.rs's set_plugin_menu). */
  setPluginMenu: (items: { command: string; label: string }[]) =>
    desktopQueryCommand("set_plugin_menu", undefined, items),
  /** The plugin commands background mode's tray or menu-bar icon lists
   *  (background/tray.rs). */
  setTrayPluginItems: (items: { command: string; label: string }[]) =>
    desktopQueryCommand("set_tray_plugin_items", undefined, items),
  /** A plugin command picked in the tray while no window was open, for
   *  the window opened for it to run - once. */
  takePendingPluginCommand: () =>
    desktopQueryCommand("take_pending_plugin_command", null),
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
    command("open_community_page", language),
  /** The website's video tutorials in the UI's language, at one lesson's
   *  clip (a TUTORIAL_CLIPS id, onboarding/tutorial-steps.ts) or, without
   *  one, from the top. */
  openTutorialsPage: (language: Lang, clip?: string) =>
    command("open_tutorials_page", clip ?? null, language),
  /** Settings › General › About Textus's links, and the theme gallery's
   *  website (the theme gallery, when it can't be reached), by name. */
  openAboutLink: (page: "github" | "discord" | "qq" | "themes") =>
    command("open_about_link", page),
  /** A web or mail link Ctrl/Cmd+clicked in a document
   *  (editor/markdown/link-click-plugin.ts). */
  openWebLink: (url: string) => command("open_web_link", url),
};

/** Web pages in tabs as native webviews of their own, laid over each tab's
 *  area (commands/web_page.rs; plugins/useNativeWebPage.ts). Desktop. */
export const webPages = {
  show: (
    id: string,
    url: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) => desktopActionCommand("web_page_show", id, url, bounds),
  hide: (id: string) => desktopActionCommand("web_page_hide", id),
  close: (id: string) => desktopActionCommand("web_page_close", id),
  navigate: (id: string, url: string) =>
    desktopActionCommand("web_page_navigate", id, url),
  reload: (id: string) => desktopActionCommand("web_page_reload", id),
};

export const exportDoc = {
  exportSaveDialog: (defaultName: string, filterName: string, ext: string) =>
    command("export_save_dialog", defaultName, filterName, ext),
  detectPandoc: () => desktopQueryCommand("detect_pandoc", null),
  exportViaPandoc: (args: {
    pandocPath: string;
    markdown: string;
    outputPath: string;
    format: string;
    resourceDir: string | null;
    title: string;
  }) =>
    desktopActionCommand(
      "export_via_pandoc",
      args.pandocPath,
      args.markdown,
      args.outputPath,
      args.format,
      args.resourceDir,
      args.title,
    ),
  openPandocInstallPage: () =>
    desktopQueryCommand("open_pandoc_install_page", undefined),
  /** Nothing to show the file in on iOS - resolves without doing anything. */
  revealInDir: (path: string) =>
    desktopQueryCommand("reveal_in_dir", undefined, path),
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
  }) =>
    desktopActionCommand(
      "export_pdf_native",
      args.html,
      args.baseDir,
      args.outputPath,
      args.pageNumbers,
    ),
};

// ---------------------------------------------------------------------------
// themes (src-tauri/src/commands/themes.rs)
// ---------------------------------------------------------------------------

export const themes = {
  saveThemeCss: (id: string, variant: "light" | "dark", css: string) =>
    command("save_theme_css", id, variant, css),
  loadThemeCss: (id: string, variant: "light" | "dark") =>
    command("load_theme_css", id, variant),
  deleteTheme: (id: string) => command("delete_theme", id),
};

/** The public theme gallery (src-tauri/src/commands/theme_gallery.rs). A
 *  file is named by its path in the gallery repository, never by URL. */
export const themeGallery = {
  catalog: () => command("theme_gallery_catalog"),
  css: (path: string) => command("theme_gallery_css", path),
  /** A screenshot, as a `data:` URL. */
  preview: (path: string) => command("theme_gallery_preview", path),
};

// ---------------------------------------------------------------------------
// auth (src-tauri/src/auth/*.rs) - API keys, OAuth, custom endpoint
// ---------------------------------------------------------------------------

export const cli = {
  cliCommandStatus: () => desktopQueryCommand("cli_command_status", false),
  installCliCommand: () => desktopActionCommand("install_cli_command"),
};

// ---------------------------------------------------------------------------
// background mode (src-tauri/src/background/) - desktop only
// ---------------------------------------------------------------------------

/** Rust -> every window: the tray changed. Mirrors STATUS_EVENT and
 *  `Status` in background/mod.rs - change both. */
export const BACKGROUND_STATUS = "background-status";
export interface BackgroundStatus extends Generated.Status {
  /** "unavailable": Linux without libayatana-appindicator (or
   *  libappindicator); the process still stays in the background. Rust
   *  sends it as a string. */
  tray: "off" | "on" | "unavailable";
}

export const background = {
  status: () =>
    desktopQueryCommand(
      "background_status",
      null,
    ) as Promise<BackgroundStatus | null>,
};

// ---------------------------------------------------------------------------
// default editor (src-tauri/src/commands/default_editor.rs) - desktop only
// ---------------------------------------------------------------------------

export type { DefaultEditorStatus } from "./bindings/app";

export const defaultEditor = {
  status: () => desktopQueryCommand("default_editor_status", null),
  set: () => desktopActionCommand("set_default_editor"),
};

// ---------------------------------------------------------------------------
// distribution (src-tauri/src/distribution.rs)
// ---------------------------------------------------------------------------

/** The channel this build was installed through - see distribution.rs,
 *  which sends it as a string. */
export type Distribution = "direct" | "homebrew" | "aur";

export const distribution = {
  appDistribution: () => command("app_distribution") as Promise<Distribution>,
};

// ---------------------------------------------------------------------------
// update (src-tauri/src/commands/update.rs) - desktop only
// ---------------------------------------------------------------------------

/** What the updater plugin's `Update` is made from: UpdateMetadata in
 *  src-tauri/src/commands/update.rs, the plugin's own check answer. */
export type UpdateMetadata = ConstructorParameters<typeof Update>[0];

export const updater = {
  /** The plugin's `check()` on `channel`'s endpoints; the `Update` it
   *  answers downloads and installs through the plugin as usual. */
  check: async (channel: UpdateChannel): Promise<Update | null> => {
    const metadata = (await desktopQueryCommand(
      "check_for_update",
      null,
      channel,
    )) as UpdateMetadata | null;
    return metadata ? new Update(metadata) : null;
  },
  /** Right before the relaunch that applies an update, so the new
   *  process is the running Textus (commands/update.rs). */
  releaseInstance: () => desktopQueryCommand("release_instance", null),
};

// ---------------------------------------------------------------------------
// drafts (src-tauri/src/commands/drafts.rs) - best-effort autosave for
// unsaved content (draft-autosave.ts).
// ---------------------------------------------------------------------------
