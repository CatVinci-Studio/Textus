//! The keys held while the system drags files over a window: the web view
//! gets no key events then, so whether Shift turns a drop into "open" is
//! read from the system (finder-drag.ts asks at most once a frame).

use serde::Serialize;

/// Read by the file drags in src/app/file-drop/finder-drag.ts.
#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct DragModifiers {
    pub shift: bool,
}

/// Sync, so it runs on the main thread, where GTK must be asked.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn drag_modifiers() -> DragModifiers {
    DragModifiers {
        shift: shift_down(),
    }
}

/// CoreGraphics, as tab_drag.rs reads the mouse: no Accessibility consent.
#[cfg(target_os = "macos")]
fn shift_down() -> bool {
    /// kCGEventSourceStateCombinedSessionState (CGEventTypes.h).
    const COMBINED_SESSION: i32 = 0;
    /// kCGEventFlagMaskShift = NX_SHIFTMASK (IOLLEvent.h).
    const SHIFT_MASK: u64 = 0x0002_0000;
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceFlagsState(state_id: i32) -> u64;
    }
    unsafe { CGEventSourceFlagsState(COMBINED_SESSION) & SHIFT_MASK != 0 }
}

#[cfg(windows)]
fn shift_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_SHIFT};
    unsafe { GetAsyncKeyState(VK_SHIFT.0 as i32) < 0 }
}

#[cfg(target_os = "linux")]
fn shift_down() -> bool {
    use gtk::gdk;
    gdk::Display::default()
        .and_then(|display| gdk::Keymap::for_display(&display))
        .is_some_and(|keymap| {
            gdk::ModifierType::from_bits_truncate(keymap.modifier_state())
                .contains(gdk::ModifierType::SHIFT_MASK)
        })
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn shift_down() -> bool {
    false
}
