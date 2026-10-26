//! What a request sends the frontend as it runs: the reply's text and
//! thinking, its tool calls as they stream, its edit tags as the calls
//! they stand for, and each finished turn.

use super::*;

/// One live fragment of an in-flight `ai_agent_message`. Display only: the
/// command still resolves with the complete turn list, so a dropped event costs
/// liveness, never correctness.
#[derive(Clone, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
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
    /// The step being streamed came back garbled and is asked for again: drop
    /// what it streamed and show the new attempt instead.
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

/// Where a request's live events go: the window's channel on the desktop,
/// a test's or a server's own sink elsewhere.
pub(crate) trait EventSink: Send + Sync {
    /// Never fails the request: a closed window only stops the show.
    fn send(&self, event: StreamEvent);
}

impl EventSink for Channel<StreamEvent> {
    fn send(&self, event: StreamEvent) {
        let _ = Channel::send(self, event);
    }
}

/// Forwards a provider-level fragment to `channel`. A native search
/// citation goes to the request's sources instead.
pub(crate) fn forward(
    channel: &dyn EventSink,
    web: &WebPlan,
    pictures: Option<&InlinePictures<'_>>,
    event: ProviderEvent<'_>,
) {
    for picture in pictures.map(|p| p.observe(&event)).unwrap_or_default() {
        channel.send(picture);
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
    channel.send(event);
}

/// Forwards what the agent loop reports onto the frontend channel, each turn as
/// the frontend's history keeps it.
pub(crate) fn report(channel: &dyn EventSink) -> impl FnMut(LoopEvent<'_>) + '_ {
    move |event| {
        let event = match event {
            LoopEvent::Turn(turn) => StreamEvent::Turn {
                turn: for_history(turn.clone()),
            },
            LoopEvent::Retry => StreamEvent::Retry,
        };
        channel.send(event);
    }
}
