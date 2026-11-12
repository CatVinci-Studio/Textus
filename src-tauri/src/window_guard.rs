//! What a window showing the app may load: its own pages and the plugins'
//! and pictures it serves, and HTTPS (the webviews ask this of every frame,
//! a plugin page's embeds too, and can't say which one is asking). Anything
//! else - plain HTTP elsewhere, file:, other schemes - goes nowhere: the
//! links a user clicks open in the browser from the page's own handlers, so
//! what arrives here unasked (a frame sending itself away) isn't opened for
//! it. A page without the app's origin gets no IPC either way.

use tauri::{AppHandle, Url};

/// The app's own hosts, as Windows and Android serve its schemes.
const OWN_HOSTS: [&str; 4] = [
    "tauri.localhost",
    "textus-plugin.localhost",
    "asset.localhost",
    "ipc.localhost",
];

pub(crate) fn may_load(url: &Url, dev: bool) -> bool {
    match (url.scheme(), url.host_str()) {
        ("tauri" | "textus-plugin" | "asset" | "about" | "blob" | "data" | "https", _) => true,
        ("http", Some(host)) if OWN_HOSTS.contains(&host) => true,
        ("http", Some("localhost" | "127.0.0.1")) => dev,
        _ => false,
    }
}

/// Opens an address outside the app, in the browser or mail; any other kind
/// of address goes nowhere.
pub(crate) fn open_outside(app: &AppHandle, url: &Url) {
    use tauri_plugin_opener::OpenerExt;
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

pub(crate) fn guard<'a, R: tauri::Runtime, M: tauri::Manager<R>>(
    builder: tauri::WebviewWindowBuilder<'a, R, M>,
) -> tauri::WebviewWindowBuilder<'a, R, M> {
    builder.on_navigation(|url| may_load(url, tauri::is_dev()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn loads(url: &str, dev: bool) -> bool {
        may_load(&Url::parse(url).unwrap(), dev)
    }

    #[test]
    fn the_app_its_plugins_and_https_load_nothing_else() {
        assert!(loads("tauri://localhost/index.html", false));
        assert!(loads(
            "http://tauri.localhost/index.html?window=small",
            false
        ));
        assert!(loads("http://textus-plugin.localhost/p/view.html", false));
        assert!(loads("textus-plugin://localhost/p/view.html", false));
        assert!(loads("about:srcdoc", false));
        assert!(loads("https://www.youtube.com/embed/x", false));
        assert!(loads("http://localhost:1420/", true));
        assert!(!loads("http://localhost:1420/", false));
        assert!(!loads("http://example.com/", false));
        assert!(!loads("file:///etc/passwd", false));
        assert!(!loads("http://tauri.localhost.evil.com/", false));
    }
}
