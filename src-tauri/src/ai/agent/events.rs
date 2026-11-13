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

/// How often merged fragments go to the window: tokens come far faster than
/// a frame, and each send is a script the page runs.
const PACE: std::time::Duration = std::time::Duration::from_millis(30);

/// A sink that merges a run of text, thinking or one call's argument
/// fragments and sends them at most every `PACE`; any other event sends what
/// waits first, so the order holds. What still waits goes on drop.
pub(crate) struct Paced<'a> {
    sink: &'a dyn EventSink,
    state: std::sync::Mutex<(Option<StreamEvent>, Option<std::time::Instant>)>,
}

impl<'a> Paced<'a> {
    pub(crate) fn new(sink: &'a dyn EventSink) -> Self {
        Self {
            sink,
            state: std::sync::Mutex::default(),
        }
    }
}

/// `next` added to `waiting` when both are fragments of one stream.
fn merged(waiting: &mut StreamEvent, next: &StreamEvent) -> bool {
    match (waiting, next) {
        (StreamEvent::Delta { text }, StreamEvent::Delta { text: more })
        | (StreamEvent::Thinking { text }, StreamEvent::Thinking { text: more }) => {
            text.push_str(more);
            true
        }
        (
            StreamEvent::ToolArgsDelta { call_id, delta },
            StreamEvent::ToolArgsDelta {
                call_id: next_id,
                delta: more,
            },
        ) if call_id == next_id => {
            delta.push_str(more);
            true
        }
        _ => false,
    }
}

impl EventSink for Paced<'_> {
    fn send(&self, event: StreamEvent) {
        let fragment = matches!(
            event,
            StreamEvent::Delta { .. }
                | StreamEvent::Thinking { .. }
                | StreamEvent::ToolArgsDelta { .. }
        );
        let mut out = Vec::new();
        {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            let (waiting, last) = &mut *state;
            let joined = match waiting.as_mut() {
                Some(w) => merged(w, &event),
                None => false,
            };
            if !joined {
                out.extend(waiting.take());
                if fragment {
                    *waiting = Some(event);
                } else {
                    out.push(event);
                }
            }
            if last.is_none_or(|at| at.elapsed() >= PACE) {
                out.extend(waiting.take());
                *last = Some(std::time::Instant::now());
            }
        }
        for event in out {
            self.sink.send(event);
        }
    }
}

impl Drop for Paced<'_> {
    fn drop(&mut self) {
        let waiting = self
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .0
            .take();
        if let Some(event) = waiting {
            self.sink.send(event);
        }
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

#[cfg(test)]
mod paced_tests {
    use super::*;

    struct Kept(std::sync::Mutex<Vec<StreamEvent>>);
    impl EventSink for Kept {
        fn send(&self, event: StreamEvent) {
            self.0.lock().unwrap().push(event);
        }
    }
    fn delta(text: &str) -> StreamEvent {
        StreamEvent::Delta { text: text.into() }
    }

    #[test]
    fn tokens_go_out_merged_and_in_order() {
        let kept = Kept(std::sync::Mutex::default());
        {
            let paced = Paced::new(&kept);
            for word in ["a", "b", "c"] {
                paced.send(delta(word));
            }
            paced.send(StreamEvent::Retry);
            paced.send(delta("d"));
            paced.send(delta("e"));
        }
        let sent: Vec<String> = kept
            .0
            .into_inner()
            .unwrap()
            .into_iter()
            .map(|e| match e {
                StreamEvent::Delta { text } => text,
                StreamEvent::Retry => "|".into(),
                _ => "?".into(),
            })
            .collect();
        assert_eq!(sent.concat(), "abc|de");
        assert!(sent.len() <= 5, "{sent:?}");
    }
}
