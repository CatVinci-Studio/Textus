//! Plugins' floating views on the desktop: a small transparent window with
//! no frame, above every other, out of the Dock and the taskbar. The editor
//! window that opened one runs its plugin and passes its page through.

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Label prefix of every floating window: never an editor window.
pub const FLOATING_LABEL_PREFIX: &str = "floating-";

/// Where a floating view can float over the desktop: the platforms whose
/// windows can be transparent without a compositor to ask.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn floating_desktop_supported() -> bool {
    cfg!(any(target_os = "macos", windows))
}

/// The window's label for a view id: labels take letters, digits, `-`, `/`,
/// `:` and `_`, so a view's dots become `_`.
pub fn floating_label(view: &str) -> String {
    let safe: String = view
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("{FLOATING_LABEL_PREFIX}{safe}")
}

/// Opens `view`'s floating window for the calling editor window, at `x`, `y`
/// (screen points), or by the bottom-right corner of its screen; an open one
/// stays where it is. Answers the window's label.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn open_floating_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    view: String,
    x: Option<f64>,
    y: Option<f64>,
    width: f64,
    height: f64,
) -> Result<String, String> {
    let label = floating_label(&view);
    if app.get_webview_window(&label).is_some() {
        return Ok(label);
    }
    let (x, y) = match (x, y) {
        (Some(x), Some(y)) => (x, y),
        _ => corner_of(&window, width, height),
    };
    let url = format!(
        "index.html?view=floating&owner={}&key={}",
        window.label(),
        view
    );
    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(view.as_str())
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        // A click on it acts at once, though it never takes the focus first.
        .accept_first_mouse(true)
        .inner_size(width, height)
        .position(x, y);
    crate::settings::with_boot(builder, &app, &label)
        .build()
        .map_err(|err| err.to_string())?;
    Ok(label)
}

/// The bottom-right corner of the window's screen, clear of the Dock.
fn corner_of(window: &tauri::WebviewWindow, width: f64, height: f64) -> (f64, f64) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return (40.0, 40.0);
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let right = (area.position.x as f64 + area.size.width as f64) / scale;
    let bottom = (area.position.y as f64 + area.size.height as f64) / scale;
    (right - width - 32.0, bottom - height - 32.0)
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn close_floating_window(app: tauri::AppHandle, view: String) {
    if let Some(window) = app.get_webview_window(&floating_label(&view)) {
        let _ = window.destroy();
    }
}

/// Folded to a dot or unfolded: the window takes the new size, its
/// top-left corner where it was.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn resize_floating_window(app: tauri::AppHandle, view: String, width: f64, height: f64) {
    if let Some(window) = app.get_webview_window(&floating_label(&view)) {
        let _ = window.set_size(tauri::LogicalSize::new(width, height));
    }
}

/// Where the window is now, in screen points, to open there next time.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn floating_window_position(app: tauri::AppHandle, view: String) -> Option<(f64, f64)> {
    let window = app.get_webview_window(&floating_label(&view))?;
    let scale = window.scale_factor().ok()?;
    let at = window.outer_position().ok()?.to_logical::<f64>(scale);
    Some((at.x, at.y))
}

/// The editor window a floating view belongs to, brought to the front: a
/// view on the desktop opens Textus from its menu.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn show_floating_owner(app: tauri::AppHandle, owner: String) {
    if !crate::commands::chat_window::is_editor_window(&owner) {
        return;
    }
    if let Some(window) = app.get_webview_window(&owner) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_view_id_becomes_a_label_tauri_takes() {
        assert_eq!(
            floating_label("catvinci.desk-pet.pet"),
            "floating-catvinci_desk-pet_pet"
        );
    }
}
