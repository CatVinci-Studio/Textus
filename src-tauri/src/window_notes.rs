//! macOS: AppKit's window notifications, heard for every window of the
//! process.
//!
//! AppKit posts some of them from inside calls Tauri itself makes while it
//! holds its table of windows: closing a window drops its NSWindow with that
//! table borrowed (tauri-runtime-wry's `on_window_close`), and `close` makes
//! the next window key right there, posting DidBecomeKey. A Tauri window call
//! made in that moment (`ns_window`, `emit_to`, ...) is handled inline on the
//! main thread, borrows the same table and panics; on macOS that ends the app
//! with every window in it (#828). So an observer that asks Tauri anything
//! runs on a later turn of the main run loop, after Tauri has let go.

use std::ffi::c_void;
use std::sync::Arc;

/// Calls `act` with the NSWindow each time any window posts `name`, for the
/// life of the process, there and then. `act` may only touch AppKit and
/// Textus's own state, never Tauri: see the module's note. Main thread.
pub(crate) fn on_window_note(
    name: &objc2_foundation::NSNotificationName,
    act: impl Fn(*mut c_void) + 'static,
) {
    use objc2_foundation::{NSNotification, NSNotificationCenter};
    use std::ptr::NonNull;
    let block = block2::RcBlock::new(move |note: NonNull<NSNotification>| {
        // SAFETY: AppKit hands the block a live notification.
        let Some(window) = (unsafe { note.as_ref() }).object() else {
            return;
        };
        act(objc2::rc::Retained::as_ptr(&window) as *mut c_void);
    });
    // SAFETY: any window's notification (no object), delivered on the
    // thread that posts it - AppKit's main thread.
    let observer = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(name),
            None,
            None,
            &block,
        )
    };
    std::mem::forget(observer);
}

/// As `on_window_note`, for an `act` that asks Tauri: it runs once the turn
/// that posted the note is over. The window may have closed by then, so
/// `act` only compares the address with live windows before using it.
pub(crate) fn on_window_note_later(
    name: &objc2_foundation::NSNotificationName,
    act: impl Fn(*mut c_void) + Send + Sync + 'static,
) {
    let act = Arc::new(act);
    on_window_note(name, move |window| {
        let act = act.clone();
        // An address, not the window: nothing is kept alive or messaged.
        let window = window as usize;
        later(move || act(window as *mut c_void));
    });
}

/// `work` on the main thread's dispatch queue, which the run loop drains
/// between its turns: never inside the call that asked, even from the main
/// thread (where Tauri's `run_on_main_thread` would run it inline).
fn later(work: impl FnOnce() + Send + 'static) {
    dispatch2::DispatchQueue::main().exec_async(work);
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2_foundation::{NSNotificationCenter, NSString};
    use std::sync::atomic::{AtomicBool, Ordering};

    /// Posts `name` with an object, as AppKit posts a window's note: the
    /// observers run inside this call, on this thread.
    fn post(name: &NSString) {
        let object = NSString::from_str("window");
        // SAFETY: a plain note with a live object; the observers are ours.
        unsafe {
            NSNotificationCenter::defaultCenter().postNotificationName_object(name, Some(&object));
        }
    }

    /// Registers a flag-setting observer for `name` the given way, posts
    /// the note, and says whether the observer ran inside the post - where
    /// Tauri's window table may still be borrowed.
    fn ran_inside_post(name: &str, register: fn(&NSString, Arc<AtomicBool>)) -> bool {
        let name = NSString::from_str(name);
        let ran = Arc::new(AtomicBool::new(false));
        register(&name, ran.clone());
        post(&name);
        ran.load(Ordering::SeqCst)
    }

    #[test]
    fn a_note_that_asks_tauri_waits_for_a_later_turn() {
        let inside = ran_inside_post("TextusTestWindowNoteLater", |name, ran| {
            on_window_note_later(name, move |_| ran.store(true, Ordering::SeqCst));
        });
        assert!(!inside, "ran while the note was being posted");
    }

    #[test]
    fn a_note_heard_now_runs_inside_the_post() {
        // The other half: notes do reach observers inside the post here, so
        // the test above would catch an observer that didn't wait.
        let inside = ran_inside_post("TextusTestWindowNoteNow", |name, ran| {
            on_window_note(name, move |_| ran.store(true, Ordering::SeqCst));
        });
        assert!(inside);
    }
}
