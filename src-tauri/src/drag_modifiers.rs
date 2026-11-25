//! The keys held while the system drags files over a window: the web view
//! gets no key events then, so whether Shift turns a drop into "open", or
//! Option (Ctrl) a move of the tree's own rows into a copy, is read from the
//! system (finder-drag.ts asks at most once a frame).

use serde::Serialize;

/// Read by the file drags in src/app/file-drop/finder-drag.ts.
#[derive(Serialize, Default)]
#[cfg_attr(test, derive(specta::Type))]
pub struct DragModifiers {
    pub shift: bool,
    /// Option on a Mac.
    pub alt: bool,
    pub ctrl: bool,
}

/// Sync, so it runs on the main thread, where GTK must be asked.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn drag_modifiers() -> DragModifiers {
    held()
}

/// CoreGraphics, as tab_drag.rs reads the mouse: no Accessibility consent.
#[cfg(target_os = "macos")]
fn held() -> DragModifiers {
    /// kCGEventSourceStateCombinedSessionState (CGEventTypes.h).
    const COMBINED_SESSION: i32 = 0;
    /// kCGEventFlagMaskShift, Control and Alternate (IOLLEvent.h).
    const SHIFT_MASK: u64 = 0x0002_0000;
    const CONTROL_MASK: u64 = 0x0004_0000;
    const ALT_MASK: u64 = 0x0008_0000;
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceFlagsState(state_id: i32) -> u64;
    }
    let flags = unsafe { CGEventSourceFlagsState(COMBINED_SESSION) };
    DragModifiers {
        shift: flags & SHIFT_MASK != 0,
        alt: flags & ALT_MASK != 0,
        ctrl: flags & CONTROL_MASK != 0,
    }
}

#[cfg(windows)]
fn held() -> DragModifiers {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VIRTUAL_KEY, VK_CONTROL, VK_MENU, VK_SHIFT,
    };
    let down = |key: VIRTUAL_KEY| unsafe { GetAsyncKeyState(key.0 as i32) < 0 };
    DragModifiers {
        shift: down(VK_SHIFT),
        alt: down(VK_MENU),
        ctrl: down(VK_CONTROL),
    }
}

#[cfg(target_os = "linux")]
fn held() -> DragModifiers {
    use gtk::gdk::{self, ModifierType};
    let state = gdk::Display::default()
        .and_then(|display| gdk::Keymap::for_display(&display))
        .map(|keymap| ModifierType::from_bits_truncate(keymap.modifier_state()))
        .unwrap_or_else(ModifierType::empty);
    DragModifiers {
        shift: state.contains(ModifierType::SHIFT_MASK),
        alt: state.contains(ModifierType::MOD1_MASK),
        ctrl: state.contains(ModifierType::CONTROL_MASK),
    }
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn held() -> DragModifiers {
    DragModifiers::default()
}
