pub mod agent;
pub mod builtin;
pub mod cancel;
pub mod catalog;
pub mod client;
pub mod conventions;
pub mod doc_blocks;
pub mod images;
pub mod levis_project;
#[cfg(test)]
mod live_eval;
pub mod memory;
pub mod next_message;
pub mod project;
pub mod route;
pub mod rules;
pub mod tools;
pub(crate) mod ui_language;
pub mod web;
pub mod workspace;

/// The settings.json field of the master switch, Settings > Textus AI >
/// Enable Textus AI (`textusAi` in SettingsContext.tsx). Missing means on.
pub(crate) const TEXTUS_AI_SETTING: &str = "textusAi";

/// What a request to an AI service is refused with while Textus AI is off.
/// Mirrors `AI_OFF` in src/platform/ai-gate.ts.
pub(crate) const TEXTUS_AI_OFF: &str = "textus-ai-off";

/// Refuses a command that would send something to an AI service while
/// Textus AI is turned off. The frontend never asks then (it checks the
/// switch at every entry point, and ipc.ts refuses too); this keeps a
/// request from going out even if one slipped through.
pub(crate) fn ensure_on(app: &tauri::AppHandle) -> Result<(), String> {
    allows(crate::settings::read_setting(app, TEXTUS_AI_SETTING))
}

fn allows(setting: Option<serde_json::Value>) -> Result<(), String> {
    match setting.and_then(|v| v.as_bool()) {
        Some(false) => Err(TEXTUS_AI_OFF.to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn requests_are_refused_only_while_textus_ai_is_off() {
        assert_eq!(allows(Some(json!(false))), Err(TEXTUS_AI_OFF.to_string()));
        assert_eq!(allows(Some(json!(true))), Ok(()));
        // Saved by a build from before the switch: on.
        assert_eq!(allows(None), Ok(()));
    }
}
