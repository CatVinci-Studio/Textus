//! The agent's IPC entry: one user message as the frontend sends it.

use super::*;

/// One user message for the agent, as the frontend sends it.
#[derive(Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MessageRequest {
    provider: String,
    /// The document, block by block as the editor has it.
    blocks: Vec<doc_blocks::SentBlock>,
    doc_path: Option<String>,
    /// The chosen project folder, or None.
    workspace_root: Option<String>,
    /// The conversation, whose scratch folder holds its attached files.
    conversation: Option<String>,
    history: Vec<AgentTurn>,
    message: String,
    /// Attachments with no text to extract; text-shaped ones were already
    /// inlined into `message` by the frontend.
    images: Vec<ImageAttachment>,
    web_search: bool,
    /// How hard the model thinks. None is Auto.
    thinking: Option<ThinkingLevel>,
    /// "auto" (None) or a service id, and the SearXNG address: what
    /// web_search uses when the model has no search of its own.
    search_service: Option<String>,
    searxng_url: Option<String>,
    mode: AgentMode,
    model: Option<String>,
    request_id: String,
    /// Heading of the section the user is working in.
    focus_heading: Option<String>,
    /// The UI language, for the names the agent is told the app uses. None
    /// is English.
    ui_language: Option<String>,
    /// The image model; None for none.
    image_model: Option<crate::ai::images::ImageModel>,
    /// General mode's file changes wait to be applied. None writes them.
    ask_before_file_changes: Option<bool>,
}

/// Sends one user message and returns the new turns for the frontend's
/// history, racing the request against its cancel signal (`ai::cancel`).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn ai_agent_message(
    app: AppHandle,
    window: tauri::Window,
    request: MessageRequest,
    on_event: Channel<StreamEvent>,
) -> Result<Vec<AgentTurn>, String> {
    let MessageRequest {
        provider,
        blocks,
        doc_path,
        workspace_root,
        conversation,
        history,
        message,
        images,
        web_search,
        thinking,
        search_service,
        searxng_url,
        mode,
        model,
        request_id,
        focus_heading,
        ui_language,
        image_model,
        ask_before_file_changes,
    } = request;
    // What every request names, as Research's requests carry it too.
    let request = AgentRequest {
        provider,
        model,
        doc_path,
        workspace_root,
        conversation,
        search_service,
        searxng_url,
        request_id,
        image_model,
        // Revisions unless told otherwise: the app's own default.
        ask_before_file_changes: ask_before_file_changes.unwrap_or(true),
    };
    let web_service = web_search.then(|| request.search_service(&app)).flatten();
    let ui_language = ui_language.unwrap_or_else(|| "en".to_string());
    let paced = events::Paced::new(&on_event);
    cancel::cancellable(
        request.request_id.clone(),
        ai_agent_message_inner(
            app,
            window.label().to_string(),
            &request,
            Document::from_blocks(blocks),
            history,
            message,
            images,
            web_search,
            web_service,
            thinking.unwrap_or_default(),
            mode,
            focus_heading,
            ui_language,
            &paced,
        ),
    )
    .await
}
