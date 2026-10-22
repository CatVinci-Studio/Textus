//! A streamed reply put together chunk by chunk: its text, reasoning and
//! tool calls, each call kept apart by its own id.

use super::*;

/// The ids a step's tool calls go by. OpenAI-compatible servers are free in
/// what they send: local ones (Ollama, LM Studio) number calls from
/// `call_0` in every reply, and some send no id at all. The app keys a
/// proposal by its call's id - its preview, its card, its status in later
/// requests - so a reused id put a new proposal in an old one's place and
/// both went (a mock server that did, live stress test of a queue of
/// requests), and a call with none was dropped. Each call keeps the id it
/// was sent unless the conversation already has it, or it has none.
#[derive(Default)]
pub(crate) struct CallIds {
    pub(crate) taken: std::collections::HashSet<String>,
}

impl CallIds {
    pub(crate) fn from_history(history: &[AgentTurn]) -> Self {
        let taken = history
            .iter()
            .filter_map(|turn| match turn {
                AgentTurn::ToolCall { call_id, .. } => Some(call_id.clone()),
                _ => None,
            })
            .collect();
        CallIds { taken }
    }

    /// The id the call at `index` goes by: `sent`, or one made from it.
    pub(crate) fn claim(&mut self, sent: &str, index: usize) -> String {
        let base = if sent.is_empty() {
            format!("call_{index}")
        } else {
            sent.to_string()
        };
        let mut id = base.clone();
        let mut n = 2;
        while self.taken.contains(&id) {
            id = format!("{base}~{n}");
            n += 1;
        }
        self.taken.insert(id.clone());
        id
    }
}

/// One tool call under construction while a Chat Completions stream is
/// being read - OpenAI-compatible servers send the id/name in the first
/// fragment and the JSON arguments in pieces after it, all addressed by
/// array index rather than id.
#[derive(Default)]
pub(crate) struct StreamToolCall {
    /// The id the server sent, then (once started) the one it goes by
    /// (CallIds).
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) args: String,
    /// ToolStart is reported once, when both id and name have arrived.
    pub(crate) started: bool,
}

/// Rebuilds the non-streaming `choices[0].message` result from Chat
/// Completions SSE chunks, reporting fragments through `on_event` as they
/// arrive. Separate from the HTTP read so the chunk bookkeeping is unit
/// testable with plain JSON fixtures.
#[derive(Default)]
pub(crate) struct ChatStreamAccumulator {
    pub(crate) text: String,
    pub(crate) reasoning: String,
    pub(crate) calls: Vec<StreamToolCall>,
    pub(crate) error: Option<String>,
    pub(crate) search: SearchReport,
    /// From the chunk that carries it - the last, with `include_usage`.
    pub(crate) usage: Option<StepUsage>,
    pub(crate) ids: CallIds,
}

impl ChatStreamAccumulator {
    pub(crate) fn apply(&mut self, data: &str, on_event: EventSink<'_>) {
        if self.error.is_some() || data.trim() == "[DONE]" {
            return;
        }
        let Ok(chunk) = serde_json::from_str::<Value>(data) else {
            return;
        };
        // Mid-stream failures arrive as an `error` object in the data
        // payload (the HTTP status was already 200 by the time they occur).
        if let Some(error) = chunk.get("error") {
            self.error = Some(format!("Custom endpoint request failed: {error}"));
            return;
        }
        if let Some(usage) = chunk.get("usage").and_then(StepUsage::from_openai) {
            self.usage = Some(usage);
        }
        let Some(delta) = chunk
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first())
            .and_then(|c| c.get("delta"))
        else {
            self.search.take(&Value::Null, &chunk);
            return;
        };
        self.search.take(delta, &chunk);

        if let Some(thought) = reasoning_of(delta) {
            if !thought.is_empty() {
                self.reasoning.push_str(thought);
                on_event(ProviderEvent::Thinking(thought));
            }
        }

        if let Some(text) = delta.get("content").and_then(|c| c.as_str()) {
            if !text.is_empty() {
                self.text.push_str(text);
                on_event(ProviderEvent::Text(text));
            }
        }

        for tc in delta
            .get("tool_calls")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
        {
            let index = tc
                .get("index")
                .and_then(|i| i.as_u64())
                .map(|i| i as usize)
                .unwrap_or(self.calls.len().saturating_sub(1));
            while self.calls.len() <= index {
                self.calls.push(StreamToolCall::default());
            }
            let call = &mut self.calls[index];
            if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                if !call.started {
                    call.id = id.to_string();
                }
            }
            if let Some(name) = tc
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|v| v.as_str())
            {
                call.name = name.to_string();
            }
            if !call.started && !call.name.is_empty() {
                call.started = true;
                call.id = self.ids.claim(&call.id, index);
                on_event(ProviderEvent::ToolStart {
                    call_id: &call.id,
                    name: &call.name,
                });
            }
            if let Some(part) = tc
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|v| v.as_str())
            {
                if !part.is_empty() {
                    call.args.push_str(part);
                    if call.started {
                        on_event(ProviderEvent::ToolArgs {
                            call_id: &call.id,
                            delta: part,
                        });
                    }
                }
            }
        }
    }

    pub(crate) fn into_step_result(self, on_event: EventSink<'_>) -> StepResult {
        let mut calls: Vec<AgentTurn> = self
            .calls
            .into_iter()
            .filter(|c| c.started)
            .map(|c| AgentTurn::ToolCall {
                call_id: c.id,
                name: c.name,
                arguments: if c.args.is_empty() {
                    "{}".to_string()
                } else {
                    c.args
                },
                reasoning: None,
            })
            .collect();
        if !calls.is_empty() {
            attach_reasoning(&mut calls, &self.reasoning);
            StepResult::calls_with_text(calls, self.search.cite(&self.text, on_event))
        } else {
            StepResult::Done(self.search.cite(&self.text, on_event))
        }
    }
}
