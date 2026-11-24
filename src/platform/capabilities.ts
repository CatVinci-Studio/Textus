import {
  isAndroidPlatform,
  isDesktop,
  isIOSPlatform,
  isLinuxPlatform,
  isMacPlatform,
  isWindowsPlatform,
} from "./os";

/**
 * What this build can do: the one place the desktop/iOS split is decided on
 * the frontend. Flags false on iOS stand for Rust APIs behind `#[cfg(desktop)]`.
 */

/** macOS, Windows or Linux - Rust's `cfg(desktop)`. */
export const isDesktopApp = isDesktop();
export const isIOSApp = isIOSPlatform();
const isAndroidApp = isAndroidPlatform();
/** iOS or Android: one webview, touch first; its layout is the desktop's
 *  on a tablet and the phone's on a narrow screen (usePhoneLayout). */
export const isMobileApp = isIOSApp || isAndroidApp;

/** Two fingers' pinch comes only as touches: Android's web view sends no
 *  gesture events and no ctrl+wheel for it (app/touch-pinch.ts). */
export const pinchFromTouches = isAndroidApp;

/** The caret is placed only as the selection changes, so text zoomed
 *  under it leaves it behind (iOS's WebKit; app/useZoom.ts's caretAgain). */
export const caretStaysWhereTextWas = isIOSApp;

/** A system Back (Android's button or gesture), which the page answers
 *  first (mobile/back.ts). */
export const hasSystemBack = isAndroidApp;

/** More than one OS window, and windows as something the app manages
 *  (title, close, size, session restore). iOS has one fixed webview. */
export const canUseWindows = isDesktopApp;

/** A menu bar and everything that arrives through it. */
export const hasAppMenu = isDesktopApp;

/** The menu bar is the OS's own (macOS), so it gets UI-language labels sent. */
export const hasNativeMenuBar = isDesktopApp && isMacPlatform();

/** Tabs dragged out of one window into another, or into a new one, with
 *  the window following the pointer: macOS and Windows give the global
 *  cursor and window positions this needs. Linux, Wayland above all,
 *  doesn't. */
export const canDragTabsBetweenWindows =
  isDesktopApp && (isMacPlatform() || isWindowsPlatform());

/** Rows of the file tree dragged out of the window as real files, to a
 *  file manager or any other app: the system's own drag. */
export const canDragFilesOut = isDesktopApp;

/** Web page tabs as a native webview over the tab. GTK can't place a second
 *  webview, so Linux keeps the framed page. */
export const hasNativeWebPages = isDesktopApp && !isLinuxPlatform();

/** The Agent conversation popped out into its own OS window. */
export const canDetachChat = canUseWindows;

/** Toggling OS fullscreen (zen mode, View > Toggle Full Screen). */
export const canToggleFullscreen = isDesktopApp;

/** The self-updater. iOS updates come from the App Store. */
export const canAutoUpdate = isDesktopApp;

/** File > Export as PDF, through each webview's PDF backend: iOS's is the
 *  Mac's WebKit one. */
export const canExportPdf = isDesktopApp || isIOSApp;

/** Export through pandoc, an external process iOS can't spawn. */
export const canExportWithPandoc = isDesktopApp;

/** Showing a file or folder in Finder/Explorer/the file manager. */
export const canRevealInFileManager = isDesktopApp;

/** A picker for an image file: on iOS, Files' pick read through the native
 *  plugin (image-store's fileImage). */
export const canPickImageFile = isDesktopApp || isIOSApp;

/** Settings › Plugins › Install from File: a package picked on the
 *  desktop, or in Files on iOS. */
export const canInstallPluginFile = isDesktopApp || isIOSApp;

/** Load Plugin Folder and the scripts folder: a folder the app watches,
 *  on the desktop. */
export const canPickPluginFolder = isDesktopApp;

/** Files dragged in from another app arrive as their contents, with no
 *  paths (an iPad's HTML5 drop), not as the desktop's drop of paths. */
export const filesDropAsContents = isIOSApp;

/** Files from a file manager can be let go on the file tree's folders,
 *  copied in: a phone's or an iPad's drags never reach the tree. */
export const canDropFilesIntoTree = isDesktopApp;

/** A folder picker: the dialog plugin's on desktop, Files' on iOS. */
export const canPickFolder = isDesktopApp || isIOSApp;

/** File > Open Folder: on a phone, a folder picked in the system's picker
 *  (iOS opens its scope for the session; Android's is walked through the
 *  plugin, platform/scoped-folder.ts). */
export const canOpenFolder = isDesktopApp || isMobileApp;

/** Settings' "install the `textus` terminal command". */
export const canInstallCliCommand = isDesktopApp;

/** Moving files to the Trash: iOS's is the Files app's Recently Deleted. */
export const canTrashFiles = isDesktopApp || isIOSApp;

/** The Trash reached through the native plugin, not Rust's. */
export const trashesNatively = isIOSApp;

/** Settings' "Default Markdown editor". iOS has no default app to set. */
export const canSetDefaultEditor = isDesktopApp;

/** The phone menu's Documents list: iOS's own folder of documents; Android
 *  opens files and folders through the system's pickers instead. */
export const hasDocumentsList = isIOSApp;

/** A tap's light haptic (a tab picked up): both phones' plugins give one. */
export const canHaptic = isMobileApp;

/** The sponsor link: not on iOS, whose store rules keep payment outside
 *  the app from being linked to. */
export const canLinkSponsor = !isIOSApp;

/** Textus AI at all: not on iOS, which goes through App Review without it.
 *  Off, the master switch stays off (settings-normalise.ts) and the AI
 *  lessons, Settings page and chat history go with it. */
export const hasTextusAi = !isIOSApp;
