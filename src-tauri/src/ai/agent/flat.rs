use aicompat::agent::AgentTurn;
use tauri::AppHandle;

/// Providers without tool calling get the conversation flattened into one
/// plain-text turn and a single completion.
pub(super) async fn flattened_chat_turn(
    app: &AppHandle,
    provider: &str,
    instructions: &str,
    history: Vec<AgentTurn>,
    message: String,
    model: Option<&str>,
) -> Result<Vec<AgentTurn>, String> {
    fn turn_to_plain_text(turn: &AgentTurn) -> Option<String> {
        match turn {
            // Images are dropped on purpose: the command already refused an
            // image-carrying message for these providers.
            AgentTurn::User { text, .. } => Some(format!("User: {text}")),
            AgentTurn::Assistant { text, .. } => Some(format!("Assistant: {text}")),
            _ => None,
        }
    }

    let user_turn = AgentTurn::user(message);
    let mut transcript: Vec<String> = history.iter().filter_map(turn_to_plain_text).collect();
    if let Some(t) = turn_to_plain_text(&user_turn) {
        transcript.push(t);
    }

    let text = crate::ai::client::call(
        app,
        provider,
        instructions.to_string(),
        transcript.join("\n\n"),
        model,
    )
    .await?;
    Ok(vec![user_turn, AgentTurn::assistant(text)])
}
