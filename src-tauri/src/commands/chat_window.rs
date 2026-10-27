use super::args::Args;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

/// Label prefix of every detached chat window. A chat window has no tab bar
/// or document, so it must never be taken for an editor window.
pub const CHAT_LABEL_PREFIX: &str = "chat-";

/// Whether `label` names a window that hosts a document (not the drag pill
/// and not a detached chat).
pub fn is_editor_window(label: &str) -> bool {
    label != crate::tab_drag::DRAG_PILL_LABEL
        && !label.starts_with(CHAT_LABEL_PREFIX)
        && !label.starts_with(crate::commands::export::PDF_EXPORT_LABEL_PREFIX)
}

/// One detached chat window. Unlike Quick Ask it follows whatever document the
/// user edits, so there is at most one per editor window.
pub struct ChatWindowEntry {
    pub label: String,
    /// The editor window this chat serves, shared by all of its tabs.
    pub scope: String,
}

/// The editor window a detached chat belongs to, if `label` names one. Menu
/// commands focused on a chat go there, since the chat has no document.
pub fn editor_for_chat(label: &str, open: &OpenChatWindows) -> Option<String> {
    open.0
        .lock()
        .unwrap()
        .iter()
        .find(|entry| entry.label == label)
        .map(|entry| entry.scope.clone())
}

/// Everything a detached chat window needs to carry on where the embedded
/// panel left off. `state` is opaque JSON whose shape TypeScript defines.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct ChatHandoff {
    /// Window label of the editor this chat starts with; once running, the chat
    /// re-addresses itself to whichever editor last pushed it context.
    #[serde(rename = "editorLabel")]
    pub editor_label: String,
    pub state: serde_json::Value,
}

/// Handoffs waiting for their window's frontend to mount and claim them,
/// drained destructively by window label.
pub struct PendingChatHandoffs(pub Mutex<HashMap<String, ChatHandoff>>);

/// Detached chat windows currently open.
pub struct OpenChatWindows(pub Mutex<Vec<ChatWindowEntry>>);

/// The chat window serving `editor_label`, if one is open.
fn chat_serving(editor_label: &str, open: &OpenChatWindows) -> Option<String> {
    open.0
        .lock()
        .unwrap()
        .iter()
        .find(|entry| entry.scope == editor_label)
        .map(|entry| entry.label.clone())
}

/// detach_chat_window's inputs. `state` is the handoff's opaque JSON.
#[derive(serde::Deserialize)]
pub struct DetachRequest {
    state: serde_json::Value,
    position: Option<(f64, f64)>,
    title: String,
    pinned: bool,
}

/// Pops this chat out of the editor into a real OS window. `command(async)` is
/// required: a plain `#[command]` runs on the main thread, where WebView2 deadlocks.
#[tauri::command(async)]
pub fn detach_chat_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: Args<DetachRequest>,
    pending: State<PendingChatHandoffs>,
    open: State<OpenChatWindows>,
) -> Result<String, String> {
    let Args(DetachRequest {
        state,
        position,
        title,
        pinned,
    }) = request;
    let editor_label = window.label().to_string();

    // Already open for this editor: focus it rather than spawning a duplicate
    // that would race it for the same proposals.
    if let Some(existing) = chat_serving(&editor_label, &open) {
        if let Some(win) = app.get_webview_window(&existing) {
            // The mounted window won't call take_chat_handoff again: park the new state
            // under its label and tell it to claim it, or the handoff would be lost.
            pending.0.lock().unwrap().insert(
                existing.clone(),
                ChatHandoff {
                    editor_label: editor_label.clone(),
                    state,
                },
            );
            // emit_to, never the broadcasting `emit`: every event is window-addressed.
            let _ = app.emit_to(
                tauri::EventTarget::webview_window(&existing),
                CHAT_ADOPT_HANDOFF,
                (),
            );
            let _ = win.set_focus();
            return Ok(existing);
        }
        // Registered but gone (closed without the destroy handler running): drop the
        // stale entry and build a fresh window.
        open.0
            .lock()
            .unwrap()
            .retain(|entry| entry.label != existing);
    }

    let label = format!(
        "{CHAT_LABEL_PREFIX}{}",
        crate::editor_windows::next_window_id()
    );
    pending.0.lock().unwrap().insert(
        label.clone(),
        ChatHandoff {
            editor_label: editor_label.clone(),
            state,
        },
    );
    open.0.lock().unwrap().push(ChatWindowEntry {
        label: label.clone(),
        scope: editor_label.clone(),
    });

    let builder = WebviewWindowBuilder::new(
        &app,
        &label,
        // One bundle; the query string picks the chat view.
        WebviewUrl::App("index.html?view=chat".into()),
    )
    .title(title)
    .inner_size(420.0, 560.0)
    .min_inner_size(320.0, 240.0)
    // Set at build time as well so a pinned chat never flashes behind the editor
    // before React mounts.
    .always_on_top(pinned);
    // Wayland ignores the position and always_on_top; as a transient of its
    // editor the chat floats (niri) or stays above it.
    #[cfg(target_os = "linux")]
    let builder = if crate::is_wayland() {
        builder.parent(&window).map_err(|err| err.to_string())?
    } else {
        builder
    };
    // Same chrome as the editor windows: the app draws its own top row. The boot
    // script carries the settings into the chat's first frame.
    let builder = crate::settings::with_boot(builder, &app, &label);
    crate::editor_windows::build_with_app_chrome(builder, position)
        .map_err(|err| err.to_string())?;
    notify_chat_windows_changed(&app);
    Ok(label)
}

/// The chat window serving the calling editor window, if any. Asked on mount
/// and focus, so a reloaded webview never trusts a stale label.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn current_chat_window(
    window: tauri::WebviewWindow,
    open: State<OpenChatWindows>,
) -> Option<String> {
    chat_serving(window.label(), &open)
}

/// Rust -> one chat window: a fresh handoff is waiting under your label, claim
/// it. Only sent when an existing window is revealed.
pub const CHAT_ADOPT_HANDOFF: &str = "chat:adopt-handoff";

/// Claimed by the chat window's frontend at mount, and again whenever
/// CHAT_ADOPT_HANDOFF says another one is waiting. Destructive either way.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn take_chat_handoff(
    window: tauri::Window,
    pending: State<PendingChatHandoffs>,
) -> Option<ChatHandoff> {
    pending.0.lock().unwrap().remove(window.label())
}

/// Brings the detached chat serving this editor to the front without handing
/// it anything, which would overwrite its newer conversation. Returns whether there was one.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn focus_chat_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    open: State<OpenChatWindows>,
) -> bool {
    let Some(label) = chat_serving(window.label(), &open) else {
        return false;
    };
    let Some(win) = app.get_webview_window(&label) else {
        return false;
    };
    let _ = win.unminimize();
    let _ = win.show();
    win.set_focus().is_ok()
}

/// Closes the detached chat serving this editor, if one is open (re-embedding the panel).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn close_chat_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    open: State<OpenChatWindows>,
) {
    let Some(label) = chat_serving(window.label(), &open) else {
        return;
    };
    open.0.lock().unwrap().retain(|entry| entry.label != label);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
    notify_chat_windows_changed(&app);
}

/// Told to every editor window when the set of chat windows changes, so none
/// keeps pushing at a destroyed label (an `emitTo` a dead window fails silently).
pub const CHAT_WINDOWS_CHANGED: &str = "chat:windows-changed";

/// Drops registrations involving a destroyed window, in both directions: a
/// closed chat drops its entry, a closed editor drops its chat.
pub fn forget_chat_window(app: &tauri::AppHandle, label: &str, open: &OpenChatWindows) {
    // A chat scoped to the closed editor closes with it: it could only push at
    // a dead window, and on Windows/Linux it kept the process alive.
    let orphans: Vec<String> = open
        .0
        .lock()
        .unwrap()
        .iter()
        .filter(|entry| entry.scope == label)
        .map(|entry| entry.label.clone())
        .collect();
    if forget_entries(label, open) {
        notify_chat_windows_changed(app);
    }
    for orphan in orphans {
        if let Some(window) = app.get_webview_window(&orphan) {
            let _ = window.destroy();
        }
    }
}

/// The registry half, testable without an AppHandle. Returns whether anything
/// was dropped.
fn forget_entries(label: &str, open: &OpenChatWindows) -> bool {
    let mut entries = open.0.lock().unwrap();
    let before = entries.len();
    entries.retain(|entry| entry.label != label && entry.scope != label);
    entries.len() != before
}

/// Announces the registry change to every editor window (the only ones that
/// listen).
pub fn notify_chat_windows_changed(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        if is_editor_window(&label) {
            let _ = window.emit(CHAT_WINDOWS_CHANGED, ());
        }
    }
}

#[cfg(test)]
mod tests;
