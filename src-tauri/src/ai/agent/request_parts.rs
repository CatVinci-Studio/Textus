//! Pieces a request is put together from: the web's part of the prompt, the
//! installed tools, a selected picture, and whether an error refuses tools.

use super::*;

/// The system prompt with what it says about the web, when search is on.
pub(super) fn with_web_section(instructions: String, web: &WebPlan) -> String {
    match web.prompt_section() {
        Some(section) => format!("{instructions}\n\n{section}"),
        None => instructions,
    }
}

/// The tools of the MCP servers the user turned on, and of the asking
/// window's plugins the user gave ai.tools: what every mode and Research's
/// researchers offer.
pub(crate) async fn installed_tools<'a>(app: &AppHandle, window: &str) -> Vec<tools::Tool<'a>> {
    let mut installed = Vec::new();
    #[cfg(desktop)]
    installed.extend(crate::mcp::tools_for_request(app).await);
    installed.extend(crate::plugins::ai_tools::tools_for_request(app, window));
    installed
}

/// The picture a message's selection is, when it is one picture and nothing
/// else, in the document's folder, and PNG, JPEG, GIF or WebP.
pub(super) fn selected_picture(message: &str, doc_path: Option<&str>) -> Option<ImageAttachment> {
    let inner = message
        .strip_prefix("<selected-text>")?
        .split_once("</selected-text>")?
        .0
        .trim();
    if !inner.starts_with("![") {
        return None;
    }
    crate::ai::images::local_picture(inner, Path::new(doc_path?).parent()?)
}

/// Whether a request's error says the server can't take tools (it names
/// them in refusing the request), rather than any other failure.
pub(super) fn refuses_tools(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    ["tool", "function call", "function_call", "functions"]
        .iter()
        .any(|word| lower.contains(word))
        && !lower.contains("403")
        && !matches!(
            aicompat::error_kind::kind(error),
            Some("rateLimit" | "timeout" | "auth" | "balance")
        )
}
