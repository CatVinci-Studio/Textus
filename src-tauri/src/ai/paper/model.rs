//! How the paper's stages talk to a model: one step at a time, streamed
//! to the card as thinking and activity. A trait, so the stages run on a
//! scripted model in tests.

use super::research::{READ_REFERENCE_TOOL, SEARCH_REFERENCES_TOOL};
use super::{ActivityKind, PaperEvent};
use aicompat::agent::{AgentTurn, StepResult, ToolCall, ToolSpec};
use futures_util::future::BoxFuture;
use serde_json::Value;
use std::sync::Mutex;

/// One step of a model: what a stage's run asks of it. A trait, so the
/// stages run on a scripted model in tests.
pub(crate) trait Model: Sync {
    fn step<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
    ) -> BoxFuture<'a, Result<StepResult, String>>;

    /// `step`, with what it streams passed to `watch` as it comes. A model
    /// that doesn't stream just steps.
    fn step_watched<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
        _watch: Watch<'a>,
    ) -> BoxFuture<'a, Result<StepResult, String>> {
        self.step(instructions, turns, tools)
    }
}

impl Model for aicompat::providers::AgentProvider {
    fn step<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
    ) -> BoxFuture<'a, Result<StepResult, String>> {
        // A helper's text and thinking aren't shown: its activity is.
        self.step_watched(instructions, turns, tools, &|_| {})
    }

    fn step_watched<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
        watch: Watch<'a>,
    ) -> BoxFuture<'a, Result<StepResult, String>> {
        use aicompat::agent::ProviderEvent;
        Box::pin(async move {
            let on_event = |event: ProviderEvent<'_>| match event {
                ProviderEvent::Thinking(text) => watch(Streamed::Thinking(text)),
                ProviderEvent::Text(text) => watch(Streamed::Text(text)),
                ProviderEvent::ToolStart { .. } => watch(Streamed::ToolStart),
                ProviderEvent::ToolArgs { delta, .. } => watch(Streamed::ToolArgs(delta)),
                ProviderEvent::Citation { .. } => {}
            };
            aicompat::providers::AgentProvider::step(self, instructions, turns, tools, &on_event)
                .await
                .map(|(step, _)| step)
        })
    }
}

/// A piece of what a step streams, as a stage watching it sees it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Streamed<'a> {
    /// A fragment of the model's thinking.
    Thinking(&'a str),
    /// A fragment of the model's reply.
    Text(&'a str),
    /// A tool call began: the arguments that follow are its own.
    ToolStart,
    /// A fragment of a tool call's JSON arguments.
    ToolArgs(&'a str),
}

pub(crate) type Watch<'a> = &'a (dyn Fn(Streamed<'_>) + Send + Sync);

/// How much of the planner's stream a Thinking event carries: its tail.
const THINKING_TAIL: usize = 160;
/// The least time between two Thinking events.
const THINKING_EVERY: std::time::Duration = std::time::Duration::from_millis(250);

/// Gathers a stream's fragments and sends their tail as Thinking, a few
/// times a second at most: the planner's tokens arrive far faster than a
/// card needs to redraw.
pub(crate) struct ThinkingTail<'a> {
    send: &'a (dyn Fn(PaperEvent) + Sync),
    state: Mutex<(String, Option<std::time::Instant>)>,
}

impl<'a> ThinkingTail<'a> {
    pub(crate) fn new(send: &'a (dyn Fn(PaperEvent) + Sync)) -> Self {
        Self {
            send,
            state: Mutex::new((String::new(), None)),
        }
    }

    pub(crate) fn push(&self, fragment: &str) {
        let text = {
            let mut state = self.state.lock().unwrap();
            let (text, last) = &mut *state;
            text.push_str(fragment);
            // Keep the buffer bounded: only its tail is ever sent.
            if text.len() > THINKING_TAIL * 8 {
                *text = tail(text, THINKING_TAIL * 2).to_string();
            }
            if last.is_some_and(|at| at.elapsed() < THINKING_EVERY) {
                return;
            }
            *last = Some(std::time::Instant::now());
            tail(text, THINKING_TAIL).to_string()
        };
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if !text.is_empty() {
            (self.send)(PaperEvent::Thinking { text });
        }
    }
}

/// The last `chars` characters of `text`.
pub(crate) fn tail(text: &str, chars: usize) -> &str {
    let skip = text.chars().count().saturating_sub(chars);
    text.char_indices()
        .nth(skip)
        .map_or(text, |(i, _)| &text[i..])
}

/// A helper's tool call as the card tells it, or None for one it doesn't.
pub(crate) fn activity(call: &ToolCall) -> Option<(ActivityKind, String)> {
    use crate::ai::web::{SEARCH_PAPERS_TOOL, WEB_FETCH_TOOL, WEB_SEARCH_TOOL};
    let args: Value = serde_json::from_str(&call.arguments).unwrap_or_default();
    let text = |key: &str| args[key].as_str().unwrap_or("").trim().to_string();
    let (kind, detail) = match call.name.as_str() {
        WEB_SEARCH_TOOL => {
            let queries: Vec<&str> = match &args["queries"] {
                Value::Array(list) => list.iter().filter_map(Value::as_str).collect(),
                Value::String(one) => vec![one.as_str()],
                _ => args["query"].as_str().into_iter().collect(),
            };
            (ActivityKind::Search, queries.join(" · "))
        }
        WEB_FETCH_TOOL => (ActivityKind::Read, text("url")),
        SEARCH_PAPERS_TOOL => (ActivityKind::Papers, text("query")),
        SEARCH_REFERENCES_TOOL => (ActivityKind::Library, text("query")),
        READ_REFERENCE_TOOL => (ActivityKind::Library, text("path")),
        _ => return None,
    };
    Some((kind, detail))
}

/// The longest an activity's detail is sent: the card shows one line.
const DETAIL_CHARS: usize = 120;

pub(crate) fn clip(text: &str) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= DETAIL_CHARS {
        return text;
    }
    let cut: String = text.chars().take(DETAIL_CHARS - 1).collect();
    format!("{cut}…")
}
