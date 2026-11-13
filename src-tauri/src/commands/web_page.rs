//! Web pages in a tab as native webviews of their own, laid over the tab's
//! area by the frontend; unlike a frame, they open every site. HTTPS only, with
//! no app capabilities; other links go to the system browser.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::sync::Mutex;
use std::time::Duration;
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl, Window};

/// Where the page goes in its window, in CSS pixels from the window's
/// content's top left.
#[derive(Deserialize, Debug, Clone, Copy)]
#[cfg_attr(test, derive(specta::Type))]
pub struct PageBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A page started to load an address, or finished: the address its tab's
/// bar shows. A load that never finishes is one that failed.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Navigated {
    id: String,
    url: String,
    loading: bool,
}

/// What a page is told it runs in on macOS. WKWebView's own name stops before
/// Safari's "Version/… Safari/…", and sites read that as an old browser: a
/// plain Google, Bilibili's "your browser is too old".
#[cfg(target_os = "macos")]
const SAFARI_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";

/// Where a page's webview starts before going to its address. Tauri's
/// `asset:` files answer the origin a webview was made with; one no site can
/// have keeps every page from reading them.
const FIRST_ADDRESS: &str = "https://page.textus.invalid/";

/// The event a window's tabs hear their pages' addresses by.
const NAVIGATED: &str = "web-page-navigated";

/// The native page of tab `id` in `window`: one label per window and tab.
fn label(window: &Window, id: &str) -> String {
    let id: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("page-{}-{id}", window.label())
}

/// Whether webview `label` is a web page in a tab.
pub(crate) fn is_page(label: &str) -> bool {
    label.starts_with("page-")
}

/// `url` if a page may show it: HTTPS.
fn https(url: &str) -> Result<Url, String> {
    let url = Url::parse(url).map_err(|e| e.to_string())?;
    if url.scheme() != "https" {
        return Err(crate::errors::error("httpsOnly"));
    }
    Ok(url)
}

/// Shows tab `id`'s page at `bounds`, making it the first time; an existing
/// page is moved and shown again where it was left.
// Async, as a window's child webview is built (chat_window.rs).
#[tauri::command(async)]
#[cfg_attr(test, specta::specta)]
pub fn web_page_show(
    window: Window,
    id: String,
    url: String,
    bounds: PageBounds,
) -> Result<(), String> {
    let label = label(&window, &id);
    let position = LogicalPosition::new(bounds.x, bounds.y);
    let size = LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0));
    if let Some(page) = window.app_handle().get_webview(&label) {
        lock_closing().remove(&label);
        page.set_bounds(tauri::Rect {
            position: position.into(),
            size: size.into(),
        })
        .map_err(|e| e.to_string())?;
        return page.show().map_err(|e| e.to_string());
    }
    let url = https(&url)?;
    let app = window.app_handle().clone();
    let (navigated_app, window_label, tab) = (app.clone(), window.label().to_string(), id.clone());
    let first = Url::parse(FIRST_ADDRESS).map_err(|e| e.to_string())?;
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(first))
        .on_navigation({
            let app = app.clone();
            move |url| {
                if url.scheme() == "https" || url.scheme() == "about" {
                    return true;
                }
                crate::window_guard::open_outside(&app, url);
                false
            }
        })
        .on_new_window({
            let app = app.clone();
            move |url, _| {
                crate::window_guard::open_outside(&app, &url);
                NewWindowResponse::Deny
            }
        })
        .on_page_load(move |_, payload| {
            if payload.url().as_str() == FIRST_ADDRESS {
                return;
            }
            let _ = navigated_app.emit_to(
                window_label.as_str(),
                NAVIGATED,
                Navigated {
                    id: tab.clone(),
                    url: payload.url().to_string(),
                    loading: payload.event() == PageLoadEvent::Started,
                },
            );
        });
    #[cfg(target_os = "macos")]
    let builder = builder.user_agent(SAFARI_USER_AGENT);
    let page = window
        .add_child(builder, position, size)
        .map_err(|e| e.to_string())?;
    page.navigate(url).map_err(|e| e.to_string())
}

/// Hides tab `id`'s page: its tab went out of sight, or a menu or dialog is
/// over it that a native page would cover.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn web_page_hide(window: Window, id: String) -> Result<(), String> {
    match window.app_handle().get_webview(&label(&window, &id)) {
        Some(page) => page.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Pages hidden and waiting to be let go; opening one again keeps it.
static CLOSING: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

/// How long a hidden page waits before it goes: WebKit can still be drawing
/// or scrolling it, and a page removed mid-frame can crash the window.
const CLOSE_AFTER: Duration = Duration::from_millis(500);

/// Lets tab `id`'s page go: its tab closed.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn web_page_close(window: Window, id: String) -> Result<(), String> {
    let label = label(&window, &id);
    let Some(page) = window.app_handle().get_webview(&label) else {
        return Ok(());
    };
    page.hide().map_err(|e| e.to_string())?;
    lock_closing().insert(label.clone());
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(CLOSE_AFTER).await;
        if lock_closing().remove(&label) {
            if let Some(page) = app.get_webview(&label) {
                let _ = page.close();
            }
        }
    });
    Ok(())
}

fn lock_closing() -> std::sync::MutexGuard<'static, BTreeSet<String>> {
    CLOSING.lock().unwrap_or_else(|e| e.into_inner())
}

/// Takes tab `id`'s page to `url`, typed in its address bar.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn web_page_navigate(window: Window, id: String, url: String) -> Result<(), String> {
    let url = https(&url)?;
    let page = window
        .app_handle()
        .get_webview(&label(&window, &id))
        .ok_or("This page is closed.")?;
    page.navigate(url).map_err(|e| e.to_string())
}

/// Loads tab `id`'s page again.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn web_page_reload(window: Window, id: String) -> Result<(), String> {
    let page = window
        .app_handle()
        .get_webview(&label(&window, &id))
        .ok_or("This page is closed.")?;
    page.reload().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::https;

    #[test]
    fn a_page_starts_at_an_origin_no_site_has() {
        let first = super::Url::parse(super::FIRST_ADDRESS).unwrap();
        assert!(first.host_str().unwrap().ends_with(".invalid"));
    }

    #[test]
    fn only_an_https_page_opens() {
        assert!(https("https://example.com/a?b").is_ok());
        assert!(https("http://example.com").is_err());
        assert!(https("file:///etc/passwd").is_err());
        assert!(https("tauri://localhost").is_err());
        assert!(https("not a url").is_err());
    }
}
