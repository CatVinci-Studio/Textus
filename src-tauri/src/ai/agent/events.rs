//! What a request sends the frontend as it runs: the reply's text and
//! thinking, its tool calls as they stream, its edit tags as the calls
//! they stand for, and each finished turn.

use super::*;

/// One live fragment of an in-flight `ai_agent_message`, pushed to the
/// invoking window over a Tauri channel while the agent loop runs. Purely
/// additive display data: the command still resolves with the complete turn
/// list, which remains the authoritative result the frontend appends to its
/// history - a dropped or ignored event costs liveness, never correctness.
/// Mirrored by `StreamEvent` in platform/ipc.ts - the two must stay in sync.
#[derive(Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum StreamEvent {
    /// A chunk of the assistant's prose for the turn being generated.
    Delta { text: String },
    /// The model opened a tool call; its arguments follow as ToolArgsDelta.
    ToolStart { call_id: String, name: String },
    /// A raw fragment of a tool call's JSON `arguments` string.
    ToolArgsDelta { call_id: String, delta: String },
    /// A completed intermediate turn (ToolCall/ToolResult) as it lands.
    Turn { turn: AgentTurn },
    /// The step being streamed came back garbled and is asked for again
    /// (aicompat's run_agent_loop): drop what it streamed - its prose and
    /// its proposal drafts - and show the new attempt instead.
    Retry,
    /// The model is thinking: a fragment of its reasoning, or "" when the
    /// provider only says that it is. Shown above the reply, never kept.
    Thinking { text: String },
    /// A picture written into a propose_edit's text (images::inline) is
    /// being made: its `line` there stands for picture `id` from now on.
    /// Sent before the fragment that completes the line.
    Picture {
        call_id: String,
        line: String,
        id: String,
        width: u32,
        height: u32,
    },
}

/// Forwards a provider-level fragment onto the frontend channel. Send
/// failures are ignored deliberately - a closed webview mid-request must
/// not fail the agent loop, which still returns turns for the history.
/// A native search citation goes to the request's sources instead (it is
/// shown with the finished reply).
pub(crate) fn forward(
    channel: &Channel<StreamEvent>,
    web: &WebPlan,
    pictures: Option<&InlinePictures<'_>>,
    event: ProviderEvent<'_>,
) {
    for picture in pictures.map(|p| p.observe(&event)).unwrap_or_default() {
        let _ = channel.send(picture);
    }
    let event = match event {
        ProviderEvent::Citation { url, title } => {
            web.cite(url, title);
            return;
        }
        ProviderEvent::Text(text) => StreamEvent::Delta {
            text: text.to_string(),
        },
        ProviderEvent::ToolStart { call_id, name } => StreamEvent::ToolStart {
            call_id: call_id.to_string(),
            name: name.to_string(),
        },
        ProviderEvent::ToolArgs { call_id, delta } => StreamEvent::ToolArgsDelta {
            call_id: call_id.to_string(),
            delta: delta.to_string(),
        },
        ProviderEvent::Thinking(text) => StreamEvent::Thinking {
            text: text.to_string(),
        },
    };
    let _ = channel.send(event);
}

/// Forwards what the agent loop reports onto the frontend channel, each
/// turn as the frontend's history keeps it (see `forward` on send errors).
pub(crate) fn report(channel: &Channel<StreamEvent>) -> impl FnMut(LoopEvent<'_>) + '_ {
    move |event| {
        let event = match event {
            LoopEvent::Turn(turn) => StreamEvent::Turn {
                turn: for_history(turn.clone()),
            },
            LoopEvent::Retry => StreamEvent::Retry,
        };
        let _ = channel.send(event);
    }
}
