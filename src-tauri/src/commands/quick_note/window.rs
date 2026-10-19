//! The Quick Note window: a small pad that opens over whatever the user is
//! doing, in the top third of the screen the pointer is on, and goes away
//! again once the note is saved.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

/// The window's label. There is only ever one: the shortcut pressed while
/// it is open brings it forward. Not an editor window
/// (chat_window::is_editor_window) - it has no tabs, takes no files and
/// no document menu commands.
pub const LABEL: &str = "quick-note";

pub const DEFAULT_SIZE: (f64, f64) = (520.0, 300.0);
pub const MIN_SIZE: (f64, f64) = (360.0, 200.0);

/// Whether Textus was in the background when the note was asked for. macOS
/// then hides the app again once the note is done, so the user is back in
/// the app they were typing in rather than looking at an editor window
/// AppKit brought forward in its place.
static OPENED_FROM_ELSEWHERE: AtomicBool = AtomicBool::new(false);

/// When the open was asked for, to report how long the window took to take
/// typing (quick_note_ready; TEXTUS_QUICK_NOTE_TIMING=1 prints it).
static OPENED_AT: Mutex<Option<Instant>> = Mutex::new(None);

/// Opens (or brings forward) the window from a context that must not build
/// one itself: the shortcut's handler, a menu click, a second launch. Built
/// off the main thread for the reason commands/chat_window.rs gives -
/// building a webview from inside a webview's own callback deadlocks on
/// Windows - and so the caller returns at once.
pub fn open_soon(app: &AppHandle) {
    *OPENED_AT.lock().unwrap() = Some(Instant::now());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = open(&app) {
            eprintln!("quick note: could not open the window: {err}");
        }
    });
}

fn open(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(LABEL) {
        // Already taking typing: nothing to time.
        OPENED_AT.lock().unwrap().take();
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let elsewhere = !app
        .webview_windows()
        .values()
        .any(|w| w.is_focused().unwrap_or(false));
    OPENED_FROM_ELSEWHERE.store(elsewhere, Ordering::Relaxed);

    let (width, height) =
        crate::commands::prefs::read_quick_note_window_size(app).unwrap_or(DEFAULT_SIZE);
    let builder = WebviewWindowBuilder::new(
        app,
        LABEL,
        // The same bundle and entry as every window; the query picks the
        // view, which src/main.tsx loads on its own (no App behind it).
        WebviewUrl::App("index.html?view=quick-note".into()),
    )
    .title(crate::app_identity::APP_NAME)
    .inner_size(width, height)
    .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
    .always_on_top(true)
    // Shown below, once it is where it belongs: the builder only takes a
    // position in logical pixels of an unknown monitor.
    .visible(false);
    // On every Space, so it opens on the one the user is looking at
    // (window.rs's macOS half lets it join a full-screen app's too).
    #[cfg(target_os = "macos")]
    let builder = builder.visible_on_all_workspaces(true);
    // A pad, not a window to come back to from the taskbar - and a
    // taskbar entry that closes itself would only flash.
    #[cfg(any(windows, target_os = "linux"))]
    let builder = builder.skip_taskbar(true);
    // Wayland ignores both the position and always_on_top above. As a
    // transient of an editor window, when there is one, it is a dialog to
    // the compositor - niri floats it, stacking compositors keep it above -
    // as for the detached chat (commands/chat_window.rs).
    #[cfg(target_os = "linux")]
    let builder = match crate::is_wayland()
        .then(|| {
            app.webview_windows()
                .into_iter()
                .find(|(label, _)| crate::commands::chat_window::is_editor_window(label))
        })
        .flatten()
    {
        Some((_, parent)) => builder.parent(&parent)?,
        None => builder,
    };
    // The app's own chrome and the settings on the first frame, as every
    // app window has them (lib.rs, settings.rs).
    let builder = crate::settings::with_boot(builder, app, LABEL);
    let window = crate::build_with_app_chrome(builder, None)?;
    place(app, &window, (width, height));
    #[cfg(target_os = "macos")]
    join_full_screen_spaces(&window);
    window.show()?;
    window.set_focus()?;
    Ok(())
}

/// A monitor's area in physical pixels, and its scale.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Screen {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

impl Screen {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x as f64
            && y >= self.y as f64
            && x < self.x as f64 + self.width as f64
            && y < self.y as f64 + self.height as f64
    }
}

/// Where a window of `size` (logical) goes on `screen`: centred across it,
/// and centred on the line a third of the way down - the top third, where
/// the eye already is and a launcher opens - but never off its top.
pub fn top_third(screen: &Screen, size: (f64, f64)) -> (i32, i32) {
    let width = (size.0 * screen.scale).round() as i32;
    let height = (size.1 * screen.scale).round() as i32;
    let x = screen.x + (screen.width as i32 - width) / 2;
    let margin = (screen.height as i32) / 12;
    let y = screen.y + (screen.height as i32 / 3 - height / 2).max(margin);
    (x.max(screen.x), y)
}

/// The screen under the pointer, else the first one.
pub fn screen_at(screens: &[Screen], pointer: Option<(f64, f64)>) -> Option<Screen> {
    pointer
        .and_then(|(x, y)| screens.iter().find(|s| s.contains(x, y)))
        .or(screens.first())
        .copied()
}

fn place(app: &AppHandle, window: &tauri::WebviewWindow, size: (f64, f64)) {
    let screens: Vec<Screen> = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| Screen {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
            scale: m.scale_factor(),
        })
        .collect();
    let pointer = app.cursor_position().ok().map(|p| (p.x, p.y));
    let Some(screen) = screen_at(&screens, pointer) else {
        return;
    };
    let (x, y) = top_third(&screen, size);
    let _ = window.set_position(PhysicalPosition::new(x, y));
    // The window was sized for the monitor it was created on; on one with
    // another scale the same logical size is another physical one.
    let _ = window.set_size(tauri::LogicalSize::new(size.0, size.1));
}

/// macOS: lets the window into a full-screen app's Space as well - the
/// Spaces setting alone keeps it out of those - so the shortcut works over
/// a full-screen browser or editor. AppKit, so on the main thread.
#[cfg(target_os = "macos")]
fn join_full_screen_spaces(window: &tauri::WebviewWindow) {
    let handle = window.clone();
    let _ = window.run_on_main_thread(move || {
        use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
        let Ok(ptr) = handle.ns_window() else {
            return;
        };
        // SAFETY: tao hands out its live NSWindow, and this runs on the
        // main thread, where AppKit objects may be touched.
        let ns_window = unsafe { &*(ptr as *const NSWindow) };
        let behavior = ns_window.collectionBehavior()
            | NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary;
        ns_window.setCollectionBehavior(behavior);
    });
}

/// The note is done: the window remembers its size and goes. With
/// `back_to_previous_app`, macOS hides Textus again if the note was asked
/// for from another app, which hands focus back to it (Windows and Linux do
/// that by themselves once the window is gone).
pub fn finish(app: &AppHandle, back_to_previous_app: bool) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    crate::commands::prefs::remember_quick_note_window_size(app, &window.as_ref().window());
    let _ = window.destroy();
    let elsewhere = OPENED_FROM_ELSEWHERE.swap(false, Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    if back_to_previous_app && elsewhere && !crate::commands::session::app_quitting() {
        let _ = app.hide();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (back_to_previous_app, elsewhere);
}

/// The time from the open being asked for to the editor taking typing.
pub fn ready() -> Option<u128> {
    let elapsed = OPENED_AT.lock().unwrap().take()?.elapsed().as_millis();
    if std::env::var_os("TEXTUS_QUICK_NOTE_TIMING").is_some() {
        eprintln!("quick note: ready to type {elapsed} ms after it was asked for");
    }
    Some(elapsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LEFT: Screen = Screen {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        scale: 1.0,
    };
    const RIGHT_HIDPI: Screen = Screen {
        x: 1920,
        y: -200,
        width: 2880,
        height: 1800,
        scale: 2.0,
    };

    #[test]
    fn the_window_opens_in_the_top_third_of_the_screen() {
        let (x, y) = top_third(&LEFT, DEFAULT_SIZE);
        assert_eq!(x, (1920 - 520) / 2);
        assert_eq!(y, 1080 / 3 - 150);
        // Scaled by the screen it lands on, offsets and all.
        let (x, y) = top_third(&RIGHT_HIDPI, DEFAULT_SIZE);
        assert_eq!(x, 1920 + (2880 - 1040) / 2);
        assert_eq!(y, -200 + 1800 / 3 - 300);
    }

    #[test]
    fn a_tall_window_on_a_short_screen_stays_on_it() {
        let short = Screen {
            height: 600,
            ..LEFT
        };
        let (_, y) = top_third(&short, (520.0, 900.0));
        assert_eq!(y, 600 / 12);
    }

    #[test]
    fn the_screen_under_the_pointer_is_chosen() {
        let screens = [LEFT, RIGHT_HIDPI];
        assert_eq!(
            screen_at(&screens, Some((2500.0, 100.0))),
            Some(RIGHT_HIDPI)
        );
        assert_eq!(screen_at(&screens, Some((10.0, 10.0))), Some(LEFT));
        // Unknown pointer, or one between screens: the first.
        assert_eq!(screen_at(&screens, None), Some(LEFT));
        assert_eq!(screen_at(&screens, Some((-50.0, -50.0))), Some(LEFT));
        assert_eq!(screen_at(&[], None), None);
    }
}
