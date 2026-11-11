pub mod agent;
pub mod builtin;
pub mod cancel;
pub mod catalog;
pub mod client;
pub mod conventions;
pub mod doc_blocks;
pub mod doc_title;
pub mod file_changes;
pub mod images;
pub(crate) mod json_reply;
pub mod kept_proposals;
#[cfg(test)]
mod live_eval;
pub mod memory;
pub mod next_message;
pub mod paper;
pub mod project;
pub(crate) mod project_data;
pub mod route;
pub mod rules;
pub(crate) mod scratch;
pub mod tools;
pub(crate) mod ui_language;
pub mod web;
pub mod workspace;

/// The settings.json field of the Enable Textus AI master switch. Missing
/// means on.
pub(crate) const TEXTUS_AI_SETTING: &str = "textusAi";

/// What a request to an AI service is refused with while Textus AI is off.
pub(crate) const TEXTUS_AI_OFF: &str = "textus-ai-off";

/// Refuses a command that would send something to an AI service while Textus
/// AI is off. The frontend checks too; this is the backstop.
pub(crate) fn ensure_on(app: &tauri::AppHandle) -> Result<(), String> {
    allows(crate::settings::read_setting(app, TEXTUS_AI_SETTING))
}

fn allows(setting: Option<serde_json::Value>) -> Result<(), String> {
    match setting.and_then(|v| v.as_bool()) {
        Some(false) => Err(TEXTUS_AI_OFF.to_string()),
        _ => Ok(()),
    }
}

/// `text` trimmed and cut to at most `most` characters, an ellipsis where
/// it was cut: what the model or a card is shown of something long.
pub(crate) fn clip(text: &str, most: usize) -> String {
    let text = text.trim();
    match text.char_indices().nth(most) {
        Some((at, _)) => format!("{}…", text[..at].trim_end()),
        None => text.to_string(),
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
