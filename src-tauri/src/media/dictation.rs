use serde::Serialize;
use tauri::ipc::Channel;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationEvent {
    text: String,
    done: bool,
    error: bool,
}
#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use std::{
        collections::HashMap,
        ffi::{CStr, CString},
        sync::{
            atomic::{AtomicU64, Ordering},
            Mutex,
        },
    };
    static NEXT: AtomicU64 = AtomicU64::new(1);
    type DictationChannels = Mutex<HashMap<u64, (String, Channel<DictationEvent>)>>;
    static CHANNELS: std::sync::LazyLock<DictationChannels> =
        std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));
    extern "C" {
        fn textus_dictation_start(
            token: u64,
            language: *const std::ffi::c_char,
            cb: extern "C" fn(u64, i32, *const std::ffi::c_char),
        );
        fn textus_dictation_stop(token: u64);
    }
    extern "C" fn receive(token: u64, kind: i32, text: *const std::ffi::c_char) {
        let value = unsafe { CStr::from_ptr(text) }
            .to_string_lossy()
            .into_owned();
        let channel = {
            let mut channels = CHANNELS.lock().unwrap();
            if kind == 0 {
                channels.get(&token).map(|(_, channel)| channel.clone())
            } else {
                channels.remove(&token).map(|(_, channel)| channel)
            }
        };
        if let Some(channel) = channel {
            if channel
                .send(DictationEvent {
                    text: value,
                    done: kind != 0,
                    error: kind == 2,
                })
                .is_err()
            {
                stop(token);
            }
        }
    }
    pub fn start(
        owner: String,
        language: String,
        channel: Channel<DictationEvent>,
    ) -> Result<u64, String> {
        let language = CString::new(language).map_err(|_| "Invalid language")?;
        let token = NEXT.fetch_add(1, Ordering::Relaxed);
        CHANNELS.lock().unwrap().insert(token, (owner, channel));
        unsafe { textus_dictation_start(token, language.as_ptr(), receive) };
        Ok(token)
    }
    pub fn stop_owner(owner: &str) {
        let tokens: Vec<_> = CHANNELS
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, (label, _))| label == owner)
            .map(|(token, _)| *token)
            .collect();
        for token in tokens {
            stop(token);
        }
    }
    pub fn stop(token: u64) {
        CHANNELS.lock().unwrap().remove(&token);
        unsafe { textus_dictation_stop(token) };
    }
}
#[tauri::command]
pub fn dictation_start(
    window: tauri::WebviewWindow,
    language: String,
    on_event: Channel<DictationEvent>,
) -> Result<u64, String> {
    #[cfg(target_os = "macos")]
    {
        native::start(window.label().to_string(), language, on_event)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, language, on_event);
        Err("System dictation is available on macOS. Choose MiniMax on this platform.".into())
    }
}
#[tauri::command]
pub fn dictation_stop(token: u64) {
    #[cfg(target_os = "macos")]
    native::stop(token);
    #[cfg(not(target_os = "macos"))]
    let _ = token;
}

pub fn stop_window(label: &str) {
    #[cfg(target_os = "macos")]
    native::stop_owner(label);
    #[cfg(not(target_os = "macos"))]
    let _ = label;
}
