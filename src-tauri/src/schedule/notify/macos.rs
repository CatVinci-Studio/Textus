//! macOS: UNUserNotificationCenter. Its delegate hears the click, also one
//! that launched Textus, and has notifications shown while Textus is in front
//! (the system hides them otherwise). The permission prompt comes with the
//! first notification. An unbundled build (`tauri dev`) can't use the center
//! at all - it throws - so there a notification is only logged.

use std::sync::OnceLock;

use objc2::rc::Retained;
use objc2::runtime::{NSObject, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread, DefinedClass};
use objc2_foundation::{NSBundle, NSError, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
    UNNotificationSound, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};

pub struct Ivars {
    app: tauri::AppHandle,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[ivars = Ivars]
    struct ClickDelegate;

    unsafe impl NSObjectProtocol for ClickDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for ClickDelegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List
                | UNNotificationPresentationOptions::Sound,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion: &block2::DynBlock<dyn Fn()>,
        ) {
            let id = response.notification().request().identifier().to_string();
            let app = self.ivars().app.clone();
            // AppKit's thread: the window work is Tauri's to schedule.
            let _ = app
                .clone()
                .run_on_main_thread(move || super::clicked(&app, &id));
            completion.call(());
        }
    }
);

/// The center's delegate is held weakly: this keeps ours alive.
static DELEGATE: OnceLock<SendDelegate> = OnceLock::new();
struct SendDelegate(#[allow(dead_code)] Retained<ClickDelegate>);
// SAFETY: never touched again after it is set; it only keeps the object alive.
unsafe impl Send for SendDelegate {}
unsafe impl Sync for SendDelegate {}

/// Whether this is a bundled app, which the center needs.
fn bundled() -> bool {
    let bundle = NSBundle::mainBundle();
    bundle.bundleIdentifier().is_some() && bundle.bundlePath().to_string().ends_with(".app")
}

pub fn install(app: &tauri::AppHandle) {
    if !bundled() || DELEGATE.get().is_some() {
        return;
    }
    let delegate = ClickDelegate::alloc().set_ivars(Ivars { app: app.clone() });
    // SAFETY: NSObject's init on a freshly allocated object.
    let delegate: Retained<ClickDelegate> = unsafe { msg_send![super(delegate), init] };
    UNUserNotificationCenter::currentNotificationCenter()
        .setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    let _ = DELEGATE.set(SendDelegate(delegate));
}

/// Shows it; whether its click comes back here.
pub fn show(_app: &tauri::AppHandle, id: &str, title: &str, body: &str) -> Result<bool, String> {
    if !bundled() {
        eprintln!("notification (not shown: an unbundled build): {title} - {body}");
        return Ok(false);
    }
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body));
    content.setSound(Some(&UNNotificationSound::defaultSound()));
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
        &NSString::from_str(id),
        &content,
        None,
    );
    // Asked once: the system remembers the answer, and shows its prompt
    // only the first time.
    let asked = block2::RcBlock::new(move |granted: objc2::runtime::Bool, _: *mut NSError| {
        if !granted.as_bool() {
            return;
        }
        UNUserNotificationCenter::currentNotificationCenter()
            .addNotificationRequest_withCompletionHandler(&request, None);
    });
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
        &asked,
    );
    Ok(true)
}
