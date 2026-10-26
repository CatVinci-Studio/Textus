//! The capability table: what each provider and model can be asked to do
//! beyond plain chat, and how each request has to say it. Per-provider rows
//! are hand-written; per-model reasoning is generated and built into the app.

use crate::images::ImageApi;
use crate::providers::custom::NativeWebSearch;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

mod providers;
pub use providers::*;
mod models;
pub use models::*;
mod plan;
pub use plan::*;
mod refusals;
pub use refusals::*;

/// How hard the model is asked to think. The user sees one button, Deep
/// thinking; the other two are picked by the surface.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum ThinkingLevel {
    /// Quick Ask: as little as the model allows - it is for a quick change.
    Fast,
    /// The panel with Deep thinking off: the provider's own default, so
    /// nothing is sent.
    #[default]
    Auto,
    /// Deep thinking on: `high` where the model has levels (never `xhigh`
    /// or `max`, which cost several times as much), on where it only switches.
    Deep,
}

/// How a provider takes thinking parameters on the wire.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ThinkingFormat {
    /// None at all: nothing is ever sent, and Deep thinking isn't offered.
    None,
    /// OpenAI's: `reasoning_effort` in Chat Completions, `reasoning.effort`
    /// in the Responses API; switched off as the effort `none`.
    OpenAi,
    /// Gemini's OpenAI-compatible layer: `extra_body.google.thinking_config`.
    /// It refuses `reasoning_effort` beside a thinking_config, so takes none.
    Gemini,
    /// Anthropic Messages: `thinking` (adaptive, disabled, or a budget on
    /// older models) and `output_config.effort`.
    Anthropic,
    /// `thinking: {type: "enabled" | "disabled"}`, plus `reasoning_effort`
    /// where the model has levels.
    ThinkingType,
    /// Alibaba DashScope: `enable_thinking` and `thinking_budget`.
    Qwen,
    /// OpenRouter's unified `reasoning: {effort | enabled}`.
    OpenRouter,
}

/// How a provider's own (server-side) web search is switched on, when it
/// has one. The agent offers its local search tools either way.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeSearch {
    None,
    /// The Responses API's `web_search` tool (OpenAI).
    ResponsesTool,
    /// Claude's server-side `web_search` tool.
    AnthropicTool,
    /// A switch on an otherwise OpenAI-compatible Chat Completions request.
    ChatCompletions(NativeWebSearch),
    /// The provider's OpenAI-compatible `/responses` endpoint with the
    /// `web_search` tool, used in place of Chat Completions while searching.
    CompatibleResponses,
    /// Alibaba: `/responses` for the newer Qwen generations, the Chat
    /// Completions `enable_search` switch for older ones ([`search_route`]).
    Qwen,
}

/// One provider's row.
#[derive(Clone, Copy, Debug)]
pub struct ProviderCaps {
    pub thinking: ThinkingFormat,
    pub native_search: NativeSearch,
    /// Chat Completions only: in thinking mode the provider expects each
    /// step's `reasoning_content` back on the assistant message that made
    /// the tool calls, for the rest of that exchange.
    pub replay_reasoning: bool,
    /// How the same key asks for a picture, where the provider makes them.
    pub image: Option<ImageApi>,
    /// Chat Completions only: a streamed request may ask for its token usage.
    /// Off where a server rejects unknown fields or doesn't document it; usage
    /// sent unasked is still read.
    pub stream_usage: bool,
    /// The effort Auto asks for where the provider's own default thinks far
    /// longer than writing needs. None: Auto sends nothing.
    pub auto_effort: Option<&'static str>,
}

#[cfg(test)]
mod tests;
