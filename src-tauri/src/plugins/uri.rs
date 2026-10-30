//! `textus://<plugin id>/<path>?<query>` links opened from outside Textus, for
//! the plugin they name. They wait here until a window takes them, so one
//! arriving during startup isn't lost.

use std::sync::Mutex;

use tauri::{Emitter, Manager};

/// The scheme Textus answers to.
pub const SCHEME: &str = "textus";

/// Links not yet taken by a window, oldest first.
#[derive(Default)]
pub struct PendingUris(pub Mutex<Vec<String>>);

/// Whether a launch argument is one of these links, not a file to open.
pub fn is_textus_uri(arg: &str) -> bool {
    arg.get(..SCHEME.len() + 3)
        .is_some_and(|start| start.eq_ignore_ascii_case(&format!("{SCHEME}://")))
}

/// Queues `url` for the windows and tells them one came.
pub fn deliver(app: &tauri::AppHandle, url: &str) {
    if !is_textus_uri(url) {
        return;
    }
    // A notification's click (Windows): no plugin id has no dot.
    #[cfg(desktop)]
    if let Some(id) = notification_id(url) {
        crate::schedule::notify::clicked(app, id);
        return;
    }
    if let Some(pending) = app.try_state::<PendingUris>() {
        pending.0.lock().unwrap().push(url.to_string());
    }
    let _ = app.emit("plugin-uri", ());
}

/// `textus://notification/<id>`: a notification's click, not a plugin's link.
pub fn notification_id(url: &str) -> Option<&str> {
    let rest = &url[SCHEME.len() + 3..];
    rest.strip_prefix("notification/")
        .filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_hexdigit()))
}

/// Hands the waiting links to the window that asks, and forgets them.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_take_uris(pending: tauri::State<'_, PendingUris>) -> Vec<String> {
    std::mem::take(&mut *pending.0.lock().unwrap())
}

/// Listens for links from the operating system, and takes the one Textus
/// was started with.
#[cfg(desktop)]
pub fn listen(app: &tauri::AppHandle) {
    use tauri_plugin_deep_link::DeepLinkExt;
    // Linux (an AppImage has no installer) and a Windows dev build register the
    // scheme as they run.
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    let _ = app.deep_link().register_all();
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            deliver(&handle, url.as_str());
        }
    });
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for url in urls {
            deliver(app, url.as_str());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_links_from_files() {
        assert!(is_textus_uri("textus://catvinci.zotero/item?key=AB12"));
        assert!(is_textus_uri("TEXTUS://x.y/"));
        assert!(!is_textus_uri("textus:/x"));
        assert!(!is_textus_uri("/home/me/textus://x.md"));
        assert!(!is_textus_uri("notes.md"));
        assert!(!is_textus_uri("tex"));
    }

    #[test]
    fn a_notifications_click_is_told_from_a_plugins_link() {
        assert_eq!(notification_id("textus://notification/0af3"), Some("0af3"));
        assert_eq!(notification_id("textus://notification/"), None);
        assert_eq!(notification_id("textus://notification/../x"), None);
        assert_eq!(notification_id("textus://catvinci.zotero/item"), None);
    }
}
