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
 * Backend commands for the app around the document: windows, menu, links,
 * export, themes, background mode, the default editor and updates.
 */

export interface FloatingDragArgs {
  tab: Generated.DetachedTab_Deserialize & { helpDoc: HelpDoc | null };
  title: string;
  dirty: boolean;
  destroySource: boolean;
}

export type { WindowBounds } from "./bindings/app";

export const windowIpc = {
  // Rust carries the tab's help guide as a string; it is a HelpDoc id.
  takeDetachedTab: () =>
    desktopQueryCommand(
      "take_detached_tab",
      null,
    ) as Promise<DetachedTabDoc | null>,
  listWindowBounds: () => desktopQueryCommand("list_window_bounds", []),
  moveTabToNewWindow: ({ tab }: FloatingDragArgs) =>
    desktopActionCommand("move_tab_to_new_window", tab),
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
  /** The menu event this window was opened to carry out (a macOS menu
   *  choice with no window open), if any; asks once. */
  takePendingMenuEvent: () =>
    desktopQueryCommand("take_pending_menu_event", null),
  /** The recent folder this window was opened to show (File > Open Recent
   *  with no window open), if any; asks once. */
  takePendingOpenFolder: () =>
    desktopQueryCommand("take_pending_open_folder", null),
  /** Opens files the way a file manager does: a window each, or tabs in the
   *  focused window in tab mode. */
  openPaths: (paths: string[]) => desktopActionCommand("open_paths", paths),
  /** One file in a window of its own, tab mode or not. */
  openPathInNewWindow: (path: string) =>
    desktopActionCommand("open_path_in_new_window", path),
  takePendingWindowPaths: () => command("take_pending_window_paths"),
  takePendingOpenPaths: () => command("take_pending_open_paths"),
  /** Pops the chat panel into its own OS window and resolves to its label.
   *  One per editor window: if it exists it is focused, and `state` is
   *  parked for it to claim so the conversation is handed over again. */
  detachChatWindow: (args: {
    state: ChatHandoffState;
    position: [number, number] | null;
    title: string;
    pinned: boolean;
    // Rust reads these keys as one struct the generated bindings can't type.
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
  /** The chat window serving THIS editor window, if any. */
  currentChatWindow: () => desktopQueryCommand("current_chat_window", null),
};

// Menu: only where the app draws its own because the native bar is gone.

export const menuIpc = {
  /** Runs a menu id exactly as clicking its native twin would. */
  triggerMenuItem: (id: string) =>
    desktopQueryCommand("trigger_menu_item", undefined, id),
  /** Backs File > Open Recent, whose native submenu the drawn menu can't read. */
  listRecentFiles: () => desktopQueryCommand("list_recent_files", []),
  /** The folders listed above the files there. */
  listRecentFolders: () => desktopQueryCommand("list_recent_folders", []),
  /** Rebuilds the native (macOS) menu bar with these labels. */
  setMenuLabels: (labels: Record<string, string>) =>
    desktopQueryCommand("set_menu_labels", undefined, labels),
  /** Sets the native (macOS) View items' check marks, keyed by menu id. */
  setMenuChecks: (checks: Record<string, boolean>) =>
    desktopQueryCommand("set_menu_checks", undefined, checks),
  /** Sets the native (macOS) Format items' keys, keyed by menu id. */
  setMenuAccelerators: (accelerators: Record<string, string>) =>
    desktopQueryCommand("set_menu_accelerators", undefined, accelerators),
  /** Fills the native Plugins menu with the enabled plugins' items. */
  setPluginMenu: (items: { command: string; label: string }[]) =>
    desktopQueryCommand("set_plugin_menu", undefined, items),
  /** The plugin commands the background tray icon lists. */
  setTrayPluginItems: (items: { command: string; label: string }[]) =>
    desktopQueryCommand("set_tray_plugin_items", undefined, items),
  /** A plugin command picked in the tray while no window was open, for
   *  the window opened for it to run - once. */
  takePendingPluginCommand: () =>
    desktopQueryCommand("take_pending_plugin_command", null),
};

/** The Edit menu's actions sent as the system's own items send them, to
 *  whatever has the keyboard (commands/native_edit.rs); false where the
 *  page acts itself (everywhere but macOS). */
export const editIpc = {
  natively: (action: Generated.NativeEdit) =>
    desktopQueryCommand("edit_natively", false, action),
};

/** The menus' Paste (commands/clipboard.rs): macOS shows a page that
 *  reads the clipboard a "Paste" callout first, so it pastes natively. */
export const clipboardIpc = {
  /** Cmd+V's paste into this window; false where the page pastes itself. */
  pasteNatively: () => editIpc.natively("paste"),
  /** The clipboard's plain text; null where the page reads it itself. */
  text: () => desktopQueryCommand("clipboard_text", null),
};

/** Help > Report a Problem: the system, its version and the webview's,
 *  and sending the report to be filed. */
export const systemIpc = {
  info: () => command("system_info"),
  sendReport: (report: Generated.ProblemReport_Deserialize) =>
    command("send_problem_report", report),
};

/** Roman input sources only while a plugin takes every key as a command
 *  (commands/input_source.rs; macOS). */
export const inputSourceIpc = {
  setRoman: (on: boolean) =>
    desktopQueryCommand("set_roman_input", undefined, on),
};

// Links and export

/** Our own pages, opened in the system browser. URLs are fixed in Rust,
 *  except a document link, which Rust opens only if http(s) or mailto. */
export const links = {
  /** The website's community page, in the UI's language. */
  openCommunityPage: (language: Lang) =>
    command("open_community_page", language),
  /** The website's video tutorials in the UI's language, at one lesson's
   *  clip or from the top. */
  openTutorialsPage: (language: Lang, clip?: string) =>
    command("open_tutorials_page", clip ?? null, language),
  /** About Textus's links and the theme gallery's website, by name. */
  openAboutLink: (page: "github" | "discord" | "qq" | "themes" | "listing") =>
    command("open_about_link", page),
  /** A web or mail link Ctrl/Cmd+clicked in a document. */
  openWebLink: (url: string) => command("open_web_link", url),
};

/** Web pages in tabs as native webviews laid over each tab's area. Desktop. */
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
  /** Nothing to show the file in on iOS; resolves without doing anything. */
  revealInDir: (path: string) =>
    desktopQueryCommand("reveal_in_dir", undefined, path),
  // Renders the paginated themed HTML offscreen and writes the PDF straight
  // to `path`, with no print dialog. pageNumbers stamps the finished file.
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

// Themes

export const themes = {
  saveThemeCss: (id: string, variant: "light" | "dark", css: string) =>
    command("save_theme_css", id, variant, css),
  loadThemeCss: (id: string, variant: "light" | "dark") =>
    command("load_theme_css", id, variant),
  deleteTheme: (id: string) => command("delete_theme", id),
};

/** The public theme gallery. A file is named by its gallery repo path,
 *  never by URL. */
export const themeGallery = {
  catalog: () => command("theme_gallery_catalog"),
  /** With `install`, fetched to install the theme, which counts it. */
  css: (path: string, install?: Generated.GalleryInstall) =>
    command("theme_gallery_css", path, install ?? null),
  /** A screenshot, as a `data:` URL. */
  preview: (path: string) => command("theme_gallery_preview", path),
};

// CLI command

export const cli = {
  cliCommandStatus: () => desktopQueryCommand("cli_command_status", false),
  installCliCommand: () => desktopActionCommand("install_cli_command"),
};

// Background mode (desktop only)

/** Rust -> every window: the tray changed. Keep in step with the Rust side. */
export const BACKGROUND_STATUS = "background-status";
export interface BackgroundStatus extends Generated.Status {
  /** "unavailable": Linux without libayatana-appindicator; the process
   *  still stays in the background. */
  tray: "off" | "on" | "unavailable";
}

export const background = {
  status: () =>
    desktopQueryCommand(
      "background_status",
      null,
    ) as Promise<BackgroundStatus | null>,
};

// Default editor (desktop only)

export type { DefaultEditorStatus } from "./bindings/app";

export const defaultEditor = {
  status: () => desktopQueryCommand("default_editor_status", null),
  set: () => desktopActionCommand("set_default_editor"),
};

// Distribution

/** The channel this build was installed through. */
export type Distribution = "direct" | "homebrew" | "aur";

export const distribution = {
  appDistribution: () => command("app_distribution") as Promise<Distribution>,
};

// Update (desktop only)

/** What the updater plugin's `Update` is made from. */
export type UpdateMetadata = ConstructorParameters<typeof Update>[0];

export const updater = {
  /** The plugin's `check()` on `channel`'s endpoints. `backToStable` offers
   *  a beta install the newest stable release, only when the user asks. */
  check: async (
    channel: UpdateChannel,
    backToStable = false,
  ): Promise<Update | null> => {
    const metadata = (await desktopQueryCommand(
      "check_for_update",
      null,
      channel,
      backToStable,
    )) as UpdateMetadata | null;
    return metadata ? new Update(metadata) : null;
  },
  /** Right before the relaunch that applies an update, so the new process
   *  is the running Textus. */
  releaseInstance: () => desktopQueryCommand("release_instance", null),
};
