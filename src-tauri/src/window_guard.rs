//! A window showing the app stays on the app's own pages: a link or a script
//! sending it anywhere else opens that address in the browser instead.

use tauri::{AppHandle, Url};

/// The app's own pages: its bundled ones, and the dev server while developing.
pub(crate) fn stays_in_app(url: &Url, dev: bool) -> bool {
    match (url.scheme(), url.host_str()) {
        ("tauri", _) | ("about", _) => true,
        ("http" | "https", Some("tauri.localhost")) => true,
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
    app: &AppHandle,
) -> tauri::WebviewWindowBuilder<'a, R, M> {
    let app = app.clone();
    builder.on_navigation(move |url| {
        if stays_in_app(url, tauri::is_dev()) {
            return true;
        }
        open_outside(&app, url);
        false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stays(url: &str, dev: bool) -> bool {
        stays_in_app(&Url::parse(url).unwrap(), dev)
    }

    #[test]
    fn only_the_apps_own_pages_load_in_its_windows() {
        assert!(stays("tauri://localhost/index.html", false));
        assert!(stays(
            "http://tauri.localhost/index.html?window=small",
            false
        ));
        assert!(stays("about:blank", false));
        assert!(stays("http://localhost:1420/", true));
        assert!(!stays("http://localhost:1420/", false));
        assert!(!stays("https://example.com/", false));
        assert!(!stays("file:///etc/passwd", false));
        assert!(!stays("http://tauri.localhost.evil.com/", false));
    }
}
