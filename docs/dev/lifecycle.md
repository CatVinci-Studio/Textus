# Launching, closing and quitting

How a Textus process starts, what keeps it running, and how it ends:
background mode and its tray icon, the login entry, and updates. The code
is `src-tauri/src/lib.rs` (setup and the run loop),
`src-tauri/src/background/` and `src-tauri/src/menu.rs` (`quit`). The
desktop app only; iOS has one window that the system manages.

## Launching

What a launch opens depends on its arguments (`background::launch`, tested
there):

| Command line               | Opens                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `textus`, `textus file.md` | The main window, with the files named or else the last session's documents (when Settings restores them) |
| `textus --quick-note`      | The Quick Note window alone. No session restore                                                          |
| `textus --background`      | No window at all, with background mode on: what the login entry runs. No session restore                 |
| `textus --background`, off | Nothing: the process removes the stale login entry and exits, since nothing would show that it is there  |

On Windows and Linux (release builds) a second launch hands its arguments to
the running process through `tauri-plugin-single-instance` and exits. The
running process then opens a quick note (`--quick-note`), does nothing
(`--background`), opens the files, or - with no file - restores the session
when no editor window is open (as a first launch would) and opens a new
window otherwise. On macOS, Finder and `open` reach the running app
themselves; the Dock icon clicked with no window open restores the session
the same way (`reopen_without_windows`).

## Closing the last window

Tauri asks to exit when its last window is destroyed. `keeps_running` in
`background/mod.rs` decides:

| Platform       | Background mode off  | Background mode on             |
| -------------- | -------------------- | ------------------------------ |
| macOS          | Keeps running (Dock) | Keeps running (Dock, menu bar) |
| Windows, Linux | Exits                | Keeps running (tray)           |

Every window is destroyed when it closes, the Quick Note window included;
nothing is kept hidden for later. On Linux each window's web process is
also ended with the window (`end_web_process_with_window` in `lib.rs`):
WebKitGTK kept a closed window's page running otherwise, which nobody saw
while the process exited with its last window.

## Quitting

**File › Quit**, `⌘Q` / `Ctrl + Q` and the tray's **Quit Textus** all run
`menu::quit`: it records the session, asks every window to close (so each
unsaved document gets its prompt; **Cancel** stops the quit), and once the
last window is destroyed calls `app.exit(0)`. An exit with a code is never
held back, in background mode or not. With no window open it exits at once.

## Background mode

**Settings › General › Background › Keep running in the background**
(`runInBackground`, off by default). Turning it on builds the tray icon
(`background/tray.rs`); turning it off removes the icon at once and, on
Windows and Linux with no window open, ends the process.

| Platform | Where the icon is   | Left click     | Menu        |
| -------- | ------------------- | -------------- | ----------- |
| Windows  | Notification area   | New quick note | Right click |
| macOS    | Menu bar (template) | Opens the menu | Left click  |
| Linux    | StatusNotifier tray | Opens the menu | Any click   |

The menu: **New Quick Note**, **Open Textus** (`reopen_without_windows`),
**Open Quick Notes Folder**, **Settings…**, **Quit Textus**. Its labels are
Rust's own table, in the UI language, because the tray can be up at login
before any window has sent labels; a test holds them to the locale files.
Tray clicks reach the app's menu handler as `tray:<item>` ids.

The icons are `src-tauri/icons/tray/`, made from the app icon by
`scripts/make-tray-icons.sh`: a 36 px template image for the macOS menu bar
(macOS paints it in the bar's colour, light or dark), the app icon's
rounded square at the notification area's sizes for 100-300% scaling on
Windows (`GetSystemMetrics(SM_CXSMICON)` picks one), and a 64 px PNG on
Linux.

Linux needs libayatana-appindicator (or the older libappindicator) at
runtime. tray-icon loads it on first use and panics without it, so
`tray::available` tries to load it first; without it the icon is not
built, the process still stays, and Settings says the tray isn't available.
Packaging: the `.deb` depends on `libayatana-appindicator3-1` (the tauri CLI
adds it, from the `-dev` package CI installs), the AppImage carries the
library, the `.rpm` recommends it, and the Arch package lists it as an
optional dependency. GNOME shows no tray icons without the AppIndicator
extension; Settings' hint says so.

## Open at login

**Settings › General › Background › Open at login** (`openAtLogin`, off by
default, shown only with background mode on). With both on,
`background/login.rs` writes an entry that runs `textus --background`:

- Windows: the `Textus` value of
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, the program path
  quoted. The uninstaller removes the same value; an update keeps it.
- macOS: a launch agent, `~/Library/LaunchAgents/com.catvinci.textus.plist`,
  run once at login (no `KeepAlive`, so quitting Textus ends it).
- Linux: `~/.config/autostart/textus.desktop`, with the AppImage's own path
  for an AppImage.

The entry is written when either setting changes and again at each startup
while both are on (an AppImage that moved keeps working), and removed when
either is turned off. Nothing about it runs otherwise.

## Updates

The update check runs in an editor window's frontend
(`app/useAppUpdate.ts`): at the window's start and every 4 hours while it is
open. A windowless process checks nothing, and the next window checks at
once.

- **Windows:** `tauri-plugin-updater` starts the NSIS installer (`/P
/UPDATE`, passive) and ends the process with `std::process::exit` - the
  background process, if that is where the update was started. The
  installer's `CheckIfAppIsRunning` then finds any `textus.exe` still
  running for the user and ends it (passive mode does so without asking;
  an installer run by hand asks first), so a Textus in the tray never
  blocks an install.
- **macOS and Linux:** the update is installed in place and the frontend
  calls `relaunch()`, an exit with Tauri's restart code, which
  `keeps_running` never holds back.

The relaunched app is a plain launch: a window, with the session.

## What a windowless process costs

Measured on Linux (Arch, niri on Wayland, NVIDIA, WebKitGTK 2.50, release
build, throwaway data folders, its own D-Bus session), as the process and
all its children's PSS and CPU time:

| State                                       | Processes             | PSS    | Of it private | CPU, idle 60 s |
| ------------------------------------------- | --------------------- | ------ | ------------- | -------------- |
| `--background`, never a window              | 1                     | 44 MB  | 14 MB         | 0              |
| One editor window open, idle                | 3 (app, web, network) | 365 MB | -             | 10 ms          |
| Its window closed, with the web process fix | 2 (app, network)      | 179 MB | 51 MB (app)   | 0              |
| Its window closed, before the fix           | 3 (app, web, network) | 313 MB | -             | 20 ms          |

Most of a windowless process's PSS is shared library pages (WebKitGTK, GTK,
and after a first window the GL drivers), clean and given back under
memory pressure. WebKit's network process stays once a window has been
open; it has no API to end it. The tray, its menu and the login entry add
no thread, timer or wakeup.

On macOS, expect the same shape: after the last window closes, the "Textus
Web Content" process should end (check in Activity Monitor), leaving the
app process and the networking one. On Windows, check in Task Manager that
the `msedgewebview2.exe` processes under Textus end within a few seconds of
the last window closing. Either way, measure the idle process for a minute
with nothing open (Activity Monitor's Memory and CPU columns, or
`Get-Process textus, msedgewebview2 | Select WS, CPU` in PowerShell before
and after) and compare with the table above.
