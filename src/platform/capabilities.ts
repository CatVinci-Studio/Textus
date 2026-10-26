import { isDesktop, isIOSPlatform, isLinuxPlatform, isMacPlatform } from "./os";

/**
 * What this build can do: the one place the desktop/iOS split is decided on
 * the frontend. Flags false on iOS stand for Rust APIs behind `#[cfg(desktop)]`.
 */

/** macOS, Windows or Linux - Rust's `cfg(desktop)`. */
export const isDesktopApp = isDesktop();
export const isIOSApp = isIOSPlatform();

/** More than one OS window, and windows as something the app manages
 *  (title, close, size, session restore). iOS has one fixed webview. */
export const canUseWindows = isDesktopApp;

/** A menu bar and everything that arrives through it. */
export const hasAppMenu = isDesktopApp;

/** The menu bar is the OS's own (macOS), so it gets UI-language labels sent. */
export const hasNativeMenuBar = isDesktopApp && isMacPlatform();

/** Tabs torn off into other windows. Needs global cursor and window
 *  positions, which only macOS gives reliably. */
export const canDragTabsBetweenWindows = isDesktopApp && isMacPlatform();

/** Web page tabs as a native webview over the tab. GTK can't place a second
 *  webview, so Linux keeps the framed page. */
export const hasNativeWebPages = isDesktopApp && !isLinuxPlatform();

/** The Agent conversation popped out into its own OS window. */
export const canDetachChat = canUseWindows;

/** Toggling OS fullscreen (zen mode, View > Toggle Full Screen). */
export const canToggleFullscreen = isDesktopApp;

/** The self-updater. iOS updates come from the App Store. */
export const canAutoUpdate = isDesktopApp;

/** File > Export as PDF, through each desktop webview's PDF backend. */
export const canExportPdf = isDesktopApp;

/** Export through pandoc, an external process iOS can't spawn. */
export const canExportWithPandoc = isDesktopApp;

/** Showing a file or folder in Finder/Explorer/the file manager. */
export const canRevealInFileManager = isDesktopApp;

/** A picker for an image file on disk. iOS's Files picker gives files the
 *  image store can't read by path. */
export const canPickImageFile = isDesktopApp;

/** A folder picker: the dialog plugin's on desktop, Files' on iOS. */
export const canPickFolder = isDesktopApp || isIOSApp;

/** File > Open Folder. Not on iOS: a Files folder is a security-scoped URL
 *  the backend can't walk for the search. */
export const canOpenFolder = isDesktopApp;

/** Settings' "install the `textus` terminal command". */
export const canInstallCliCommand = isDesktopApp;

/** Moving a replaced picture's file to the Trash. */
export const canTrashFiles = isDesktopApp;

/** Settings' "Default Markdown editor". iOS has no default app to set. */
export const canSetDefaultEditor = isDesktopApp;
