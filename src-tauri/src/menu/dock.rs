//! The Dock icon's menu: New Window above what AppKit lists itself. tao's
//! delegate lacks `applicationDockMenu:`, so `install` adds the method once.

use std::cell::OnceCell;
use std::ffi::c_char;
use std::sync::OnceLock;

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Imp, NSObject, Sel};
use objc2::{define_class, msg_send, sel, MainThreadOnly};
use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem};
use objc2_foundation::{MainThreadMarker, NSObjectProtocol, NSString};

use super::*;

static APP: OnceLock<AppHandle> = OnceLock::new();

thread_local! {
    // An item holds its target weakly: this keeps the one target alive.
    static TARGET: OnceCell<Retained<DockMenuTarget>> = const { OnceCell::new() };
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    struct DockMenuTarget;

    unsafe impl NSObjectProtocol for DockMenuTarget {}

    impl DockMenuTarget {
        #[unsafe(method(newWindow:))]
        fn new_window(&self, _sender: Option<&AnyObject>) {
            if let Some(app) = APP.get() {
                dispatch(app, NEW_WINDOW_ID);
            }
        }
    }
);

/// Gives the Dock icon its menu. Called once from setup, on the main
/// thread, after tao has set its delegate.
pub(crate) fn install(app: &AppHandle) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    if APP.set(app.clone()).is_err() {
        return;
    }
    let target: Retained<DockMenuTarget> = unsafe { msg_send![DockMenuTarget::alloc(mtm), init] };
    TARGET.with(|cell| {
        let _ = cell.set(target);
    });
    let Some(delegate) = NSApplication::sharedApplication(mtm).delegate() else {
        return;
    };
    let delegate: &AnyObject = delegate.as_ref();
    let dock_menu: extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> *mut NSMenu = dock_menu;
    // SAFETY: the function matches the method's types, "@@:@" (returns an object,
    // takes self, the selector and the sender); adding a missing method changes no others.
    unsafe {
        let imp: Imp = std::mem::transmute(dock_menu);
        objc2::ffi::class_addMethod(
            delegate.class() as *const _ as *mut _,
            sel!(applicationDockMenu:),
            imp,
            c"@@:@".as_ptr() as *const c_char,
        );
    }
}

/// The menu, built each time the Dock asks, in the UI's language.
extern "C-unwind" fn dock_menu(
    _this: &AnyObject,
    _cmd: Sel,
    _sender: *mut AnyObject,
) -> *mut NSMenu {
    let Some(mtm) = MainThreadMarker::new() else {
        return std::ptr::null_mut();
    };
    let title = APP
        .get()
        .and_then(|app| {
            let labels = app.try_state::<MenuLabels>()?;
            let labels = labels.0.lock().unwrap();
            labels.get(NEW_WINDOW_ID).cloned()
        })
        .unwrap_or_else(|| "New Window".to_string());
    let menu = NSMenu::new(mtm);
    let item = unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(mtm),
            &NSString::from_str(&title),
            Some(sel!(newWindow:)),
            &NSString::new(),
        )
    };
    TARGET.with(|cell| {
        if let Some(target) = cell.get() {
            unsafe { item.setTarget(Some(target)) };
        }
    });
    menu.addItem(&item);
    Retained::autorelease_return(menu)
}
