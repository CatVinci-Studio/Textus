import { isDesktop, isIOSPlatform, isMacPlatform } from "./os";
import { readBoot } from "../storage/boot";

/**
 * What this build of the app can do - the ONE place the desktop/iOS split
 * is decided on the frontend. Call sites read these flags instead of asking
 * which OS they're on, so the policy can change here without hunting
 * through components.
 *
 * Mirrors the `#[cfg(desktop)]` gating in src-tauri (see
 * docs/dev/ios-code-map.md): every flag below that is false on iOS stands for
 * Rust commands, plugins or window APIs that are not compiled or not
 * registered there, so calling them would only ever reject. The desktop-only
 * command wrappers in platform/ipc.ts check {@link isDesktopApp} as a backstop.
 *
 * Read once at module load: a webview does not change platforms, and a
 * hook would only re-render consumers for a value that cannot change.
 */

/** macOS, Windows or Linux - Rust's `cfg(desktop)`. */
export const isDesktopApp = isDesktop();
export const isIOSApp = isIOSPlatform();

/** More than one OS window, and the window itself as something the app
 *  manages: its title, closing/destroying it, remembering its size, and
 *  restoring each window's documents on the next launch (session.rs).
 *  iOS has one full-screen webview the app never opens or closes. */
export const canUseWindows = isDesktopApp;

/** A menu bar (native on macOS, app-drawn on Windows/Linux - menu.rs) and
 *  everything that arrives through it: Help docs in a fresh window,
 *  File > Open Recent, menu accelerators. */
export const hasAppMenu = isDesktopApp;

/** The menu bar is the OS's own (macOS), built in Rust: it follows the UI
 *  language only by being sent the labels (menu.rs's set_menu_labels). */
export const hasNativeMenuBar = isDesktopApp && isMacPlatform();

/** Tabs dragged out of one window into another, or into a new one
 *  (tab_drag.rs). Tear-off needs global cursor and window positions, which
 *  only macOS gives reliably; on Linux, above all under Wayland, the drag
 *  could only fail and cancel the reorder with it. The whole-window drag
 *  onto another window's tab row is on every desktop. */
export const canDragTabsBetweenWindows = isDesktopApp && isMacPlatform();

/** The Agent conversation popped out into its own OS window
 *  (chat_window.rs). */
export const canDetachChat = canUseWindows;

/** Toggling OS fullscreen (zen mode, View > Toggle Full Screen). */
export const canToggleFullscreen = isDesktopApp;

/** The self-updater (tauri-plugin-updater + process relaunch). iOS updates
 *  come from the App Store; the plugins aren't even built there. */
export const canAutoUpdate = isDesktopApp;

/** File > Export as PDF: an offscreen render through each desktop
 *  webview's own PDF backend (export.rs). */
export const canExportPdf = isDesktopApp;

/** Export through a user-installed pandoc - an external process, which iOS
 *  cannot spawn. */
export const canExportWithPandoc = isDesktopApp;

/** Showing a file or folder in Finder/Explorer/the file manager. */
export const canRevealInFileManager = isDesktopApp;

/** A picker for an image file on disk ("Choose image…" on a missing
 *  image's card). iOS has only the Files app's document picker, whose
 *  files the image store can't read by path. */
export const canPickImageFile = isDesktopApp;

/** A folder picker: the dialog plugin's on desktop, the Files app's
 *  (platform/ios-files.ts) on iOS. */
export const canPickFolder = isDesktopApp || isIOSApp;

/** File > Open Folder…: the sidebar rooted at a folder, with its file-name
 *  search (commands/folder.rs). Not on iOS: a folder picked in Files is a
 *  security-scoped URL the backend can't walk for the search, and the
 *  sidebar there keeps the app's Documents folder it always had. */
export const canOpenFolder = isDesktopApp;

/** Settings' "install the `textus` terminal command" (cli.rs, macOS only). */
export const canInstallCliCommand = isDesktopApp && isMacPlatform();

/** Moving a replaced picture's file to the system's Trash
 *  (commands/fs.rs move_picture_to_trash). */
export const canTrashFiles = isDesktopApp;

/** Settings' "Default Markdown editor" (default_editor.rs). iOS opens
 *  documents through the Files app, which has no default app to set. */
export const canSetDefaultEditor = isDesktopApp;

/** Textus AI at all: not on an iOS App Store download in mainland China,
 *  where it would need its own licence. Off, the master switch stays off
 *  (settings-normalise.ts) and the AI lessons, Settings page and chat
 *  history go with it. */
export const hasTextusAi = !readBoot()?.aiUnavailable;
