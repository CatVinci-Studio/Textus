use super::args::Args;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

/// Label prefix of every detached chat window. Window-enumeration code has
/// to be able to tell these apart from editor windows: a chat window has no
/// tab bar and no document, so offering it as a tab-drag drop target or
/// handing it files to open would silently lose whatever was sent.
pub const CHAT_LABEL_PREFIX: &str = "chat-";

/// Whether `label` names a window that hosts a document (i.e. not the drag
/// pill and not a detached chat).
pub fn is_editor_window(label: &str) -> bool {
    label != crate::tab_drag::DRAG_PILL_LABEL
        && !label.starts_with(CHAT_LABEL_PREFIX)
        && !label.starts_with(crate::commands::export::PDF_EXPORT_LABEL_PREFIX)
}

/// One detached chat window.
///
/// The Agent has exactly two surfaces, and they differ in what they are ABOUT
/// (see src/ai/chat/quick-ask/InlineChat.tsx): the in-document Quick Ask bar is scoped
/// to the one file it was opened in, while a detached window is the
/// cross-file surface - it follows whatever document the user is editing and
/// pulls each new selection in. There is therefore at most ONE chat window
/// per scope: popping the chat out of a second file must reveal the window
/// already open, never spawn a rival one that would race it for the same
/// editor's proposals.
pub struct ChatWindowEntry {
    pub label: String,
    /// The editor window this chat serves - one chat per editor window,
    /// shared by all of that window's tabs.
    pub scope: String,
}

/// The editor window a detached chat belongs to, if `label` names one.
/// Menu commands focused on a chat window are routed here - the chat has no
/// document and no menu handlers, so delivering Save/Export/Find to it would
/// silently do nothing.
pub fn editor_for_chat(label: &str, open: &OpenChatWindows) -> Option<String> {
    open.0
        .lock()
        .unwrap()
        .iter()
        .find(|entry| entry.label == label)
        .map(|entry| entry.scope.clone())
}

/// Everything a detached chat window needs to carry on where the embedded
/// panel left off. `state` is opaque JSON: the actual shape is defined once,
/// in TypeScript (src/ai/chat/window/chat-bridge.ts), so the protocol doesn't have
/// to be kept in sync across two languages for a payload Rust never inspects.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatHandoff {
    /// Window label of the editor this chat belongs to. Only the STARTING
    /// address: once running, the chat re-addresses itself to whichever
    /// editor last pushed it context (see chat-bridge.ts), which is how one
    /// window can serve several files.
    #[serde(rename = "editorLabel")]
    pub editor_label: String,
    pub state: serde_json::Value,
}

/// Handoffs waiting for their window's frontend to mount and claim them -
/// the same pattern as PendingDetachedTabs in tab_drag.rs, and drained the
/// same way (destructively, by window label).
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

/// detach_chat_window's inputs, the keys of `detachChatWindow`'s invoke in
/// platform/ipc-app.ts. `state` is the handoff's opaque JSON (ChatHandoff).
#[derive(serde::Deserialize)]
pub struct DetachRequest {
    state: serde_json::Value,
    position: Option<(f64, f64)>,
    title: String,
    pinned: bool,
}

/// Pops this chat out of the editor into a real OS window.
///
/// A native window, not a webview-drawn panel, is the whole point: the user
/// asked to be able to put it outside the main window, and only a real window
/// gets native edge/corner resizing, cross-monitor placement, and the
/// platform's own chrome.
///
/// `command(async)` is load-bearing, not a style choice. A plain `#[command]`
/// is a BLOCKING command: Tauri runs it inline on the main thread, inside the
/// calling webview's IPC callback. On Windows, building a webview from there
/// deadlocks - wry has to pump a nested message loop waiting for
/// `CreateCoreWebView2Controller` to call back, and WebView2 will not
/// re-enter one of its own event handlers to deliver it. Tauri says as much
/// on `WebviewWindowBuilder::build` ("deadlocks when used in a synchronous
/// command"). The whole app froze and, because this `invoke` never resolved,
/// the Quick Ask bar that was waiting on the returned label never hid itself
/// either. macOS never hit it: WKWebView creation is synchronous.
///
/// `async` on a non-async fn runs the body on the async runtime instead, so
/// window creation reaches the main thread as an ordinary event-loop message.
/// Nothing in here awaits, so no lock is held across a suspension point.
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

    // Already open for this editor: focus what's there rather than spawning
    // a duplicate that would race the first one for the same proposals. This
    // is also the path a SECOND file takes - popping its chat out reveals the
    // one window, which then follows that file.
    if let Some(existing) = chat_serving(&editor_label, &open) {
        if let Some(win) = app.get_webview_window(&existing) {
            // The window mounted long ago and so will never call
            // take_chat_handoff by itself again - park the new state under its
            // label and tell it to claim it, the same destructive claim the
            // mount path uses. Dropping the state here (which is what used to
            // happen) lost the whole handoff: the window went on showing its
            // previous exchange, never learned the conversation the user had
            // just had in Quick Ask, and - because Quick Ask hides itself on
            // detach - the edits that conversation proposed were left with no
            // accept/reject surface anywhere.
            pending.0.lock().unwrap().insert(
                existing.clone(),
                ChatHandoff {
                    editor_label: editor_label.clone(),
                    state,
                },
            );
            // emit_to, never the broadcasting `emit`: every event in this app
            // is window-addressed (see src/utils/tauri-events.ts).
            let _ = app.emit_to(
                tauri::EventTarget::webview_window(&existing),
                CHAT_ADOPT_HANDOFF,
                (),
            );
            let _ = win.set_focus();
            return Ok(existing);
        }
        // Registered but gone (closed without the destroy handler running) -
        // drop the stale entry and fall through to building a fresh window.
        open.0
            .lock()
            .unwrap()
            .retain(|entry| entry.label != existing);
    }

    let label = format!("{CHAT_LABEL_PREFIX}{}", crate::next_window_id());
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
        // One bundle, one entry - the query string picks the chat view. A
        // second HTML entry point would mean a second build target and a
        // second copy of the shared providers for no gain.
        WebviewUrl::App("index.html?view=chat".into()),
    )
    .title(title)
    .inner_size(420.0, 560.0)
    .min_inner_size(320.0, 240.0)
    // Set at build time as well as from the frontend so a pinned chat never
    // flashes behind the editor for the frame before its React mounts.
    .always_on_top(pinned);
    // Wayland ignores both the position and always_on_top above, so the
    // chat opened as just another toplevel: a new tiled column on niri and
    // other tiling compositors, and sinking behind the editor elsewhere. As
    // a transient of its editor it is a dialog to the compositor - niri
    // floats windows that have a parent, and stacking compositors keep it
    // above that editor.
    #[cfg(target_os = "linux")]
    let builder = if crate::is_wayland() {
        builder.parent(&window).map_err(|err| err.to_string())?
    } else {
        builder
    };
    // Same chrome as the editor windows: the app draws its own top row rather
    // than sitting under a native title bar with a second row of ours beneath
    // it - on a 420px-wide panel that second row was most of the chrome.
    // The boot script carries the settings into the chat's first frame, as
    // for an editor window (settings.rs).
    let builder = crate::settings::with_boot(builder, &app, &label);
    crate::build_with_app_chrome(builder, position).map_err(|err| err.to_string())?;
    notify_chat_windows_changed(&app);
    Ok(label)
}

/// The chat window serving the calling editor window, if any.
///
/// Editor windows call this on mount and on focus, so a reloaded webview -
/// or one whose chat was closed from the chat's own window - learns the
/// current label instead of trusting a cached one.
#[tauri::command]
pub fn current_chat_window(
    window: tauri::WebviewWindow,
    open: State<OpenChatWindows>,
) -> Option<String> {
    chat_serving(window.label(), &open)
}

/// Rust -> one chat window: a fresh handoff is waiting under your label, claim
/// it. Emitted only when `detach_chat_window` reveals a window that already
/// exists instead of building one; a window being built claims its handoff at
/// mount without being asked. Mirrors CHAT_ADOPT_HANDOFF in
/// src/ai/chat/window/chat-bridge.ts.
pub const CHAT_ADOPT_HANDOFF: &str = "chat:adopt-handoff";

/// Claimed by the chat window's frontend at mount, and again whenever
/// CHAT_ADOPT_HANDOFF says another one is waiting. Destructive either way.
#[tauri::command]
pub fn take_chat_handoff(
    window: tauri::Window,
    pending: State<PendingChatHandoffs>,
) -> Option<ChatHandoff> {
    pending.0.lock().unwrap().remove(window.label())
}

/// Brings the detached chat serving this editor to the front, without
/// handing it anything. Opening Ask AI while a chat window exists means "go
/// to the conversation", and the conversation there has moved on since it
/// left the editor - re-running `detach_chat_window` would park the editor's
/// older copy for the window to adopt, overwriting what the user did in it.
/// Returns whether there was a window to focus.
#[tauri::command]
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

/// Closes the detached chat serving this editor, if one is open - what the
/// editor calls when the user re-embeds the panel.
#[tauri::command]
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

/// Told to every editor window when the set of open chat windows changes, so
/// each webview can re-read `current_chat_window` instead of believing a
/// cache. Without it, a chat closed from its own window leaves the editor
/// pushing context at a destroyed label - silently, since an `emitTo` a
/// dead window is not an error.
pub const CHAT_WINDOWS_CHANGED: &str = "chat:windows-changed";

/// Drops registrations involving a destroyed window. Called from the global
/// window-destroyed handler for EVERY window, so it handles both directions:
/// a closed chat window drops its own entry (letting an editor detach again),
/// and a closed editor window drops the chat scoped to it.
pub fn forget_chat_window(app: &tauri::AppHandle, label: &str, open: &OpenChatWindows) {
    // A chat scoped to the editor window that just went away closes with it:
    // left open it could only push at a dead window - sends timing out,
    // Accept doing nothing - and on Windows/Linux it kept the process alive
    // after the last editor was closed. Its conversation is already in the
    // history list.
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

/// The registry half on its own, so the bookkeeping is testable without an
/// AppHandle to emit through. Returns whether anything was actually dropped.
fn forget_entries(label: &str, open: &OpenChatWindows) -> bool {
    let mut entries = open.0.lock().unwrap();
    let before = entries.len();
    entries.retain(|entry| entry.label != label && entry.scope != label);
    entries.len() != before
}

/// Announces the registry change to every editor window. Editor windows only:
/// a chat window has no cache to invalidate, and the drag pill has no
/// listeners at all.
pub fn notify_chat_windows_changed(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        if is_editor_window(&label) {
            let _ = window.emit(CHAT_WINDOWS_CHANGED, ());
        }
    }
}

#[cfg(test)]
mod tests;
