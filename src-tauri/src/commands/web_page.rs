//! Web pages in a tab as native webviews of their own (desktop): one per
//! tab, laid over the tab's area of the window by the frontend
//! (src/plugins/views/useNativeWebPage.ts), which says where it goes as the
//! layout changes and hides it when the tab goes out of sight. Unlike the
//! frame it replaces, a native page opens every site - many refuse to be
//! framed - and keeps its own cookies, as a browser would.
//!
//! The page is the web's, never the app's: HTTPS only, and as a remote
//! origin it reaches none of the app's commands (no capability names it).
//! A link to anything else - another scheme, a window of its own - goes
//! to the system browser.

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl, Window};

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

/// A page went somewhere: the address its tab's bar shows.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Navigated {
    id: String,
    url: String,
}

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

/// `url` if a page may show it: HTTPS.
fn https(url: &str) -> Result<Url, String> {
    let url = Url::parse(url).map_err(|e| e.to_string())?;
    if url.scheme() != "https" {
        return Err("Only an https:// page opens in a tab.".into());
    }
    Ok(url)
}

fn open_outside(app: &AppHandle, url: &Url) {
    use tauri_plugin_opener::OpenerExt;
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

/// Shows tab `id`'s page at `bounds`, making it the first time; a page
/// made already is moved there and shown again, at the address it was
/// left at.
#[tauri::command]
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
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .on_navigation({
            let app = app.clone();
            move |url| {
                if url.scheme() == "https" || url.scheme() == "about" {
                    return true;
                }
                open_outside(&app, url);
                false
            }
        })
        .on_new_window({
            let app = app.clone();
            move |url, _| {
                open_outside(&app, &url);
                NewWindowResponse::Deny
            }
        })
        .on_page_load(move |page, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let _ = navigated_app.emit_to(
                window_label.as_str(),
                NAVIGATED,
                Navigated {
                    id: tab.clone(),
                    url: page.url().map(|u| u.to_string()).unwrap_or_default(),
                },
            );
        });
    window
        .add_child(builder, position, size)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Hides tab `id`'s page: its tab went out of sight, or something is shown
/// over it (a menu, a dialog) that a native page would cover.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn web_page_hide(window: Window, id: String) -> Result<(), String> {
    match window.app_handle().get_webview(&label(&window, &id)) {
        Some(page) => page.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Lets tab `id`'s page go: its tab closed.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn web_page_close(window: Window, id: String) -> Result<(), String> {
    match window.app_handle().get_webview(&label(&window, &id)) {
        Some(page) => page.close().map_err(|e| e.to_string()),
        None => Ok(()),
    }
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
    fn only_an_https_page_opens() {
        assert!(https("https://example.com/a?b").is_ok());
        assert!(https("http://example.com").is_err());
        assert!(https("file:///etc/passwd").is_err());
        assert!(https("tauri://localhost").is_err());
        assert!(https("not a url").is_err());
    }
}
