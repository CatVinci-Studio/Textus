//! The capability table: what each provider and model can be asked to do
//! beyond plain chat, and how each request has to say it.
//!
//! Two layers, after pi-ai's split of wire format from provider:
//!
//! - [`provider`]: hand-written, one row per provider id (the ids of the
//!   main crate's `ai::catalog`). How thinking parameters go on the wire
//!   ([`ThinkingFormat`], pi-ai's `thinkingFormat`), how native web search is
//!   switched on ([`NativeSearch`]), and whether a step's reasoning has to be
//!   sent back with its tool calls.
//! - [`model_reasoning`]: generated. Per model, whether it thinks and which
//!   settings it takes, from models.dev's `reasoning_options`
//!   (data/model-capabilities.json, refreshed by the weekly
//!   scripts/sync-models.mjs PR and built into the app - never downloaded).
//!
//! What a request sends is [`plan`]'s answer for a [`ThinkingLevel`]: a
//! [`Thinking`] each dialect renders onto its own request body. A model the
//! table doesn't know gets nothing unless the user asked for Deep, and a
//! provider that answers 400 to the parameters is asked once more without
//! them and then left alone for the rest of the session ([`with_fallback`]).

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
/// thinking; the other two are picked by the surface. Mirrored by
/// `ThinkingLevel` in src/ai/types.ts.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThinkingLevel {
    /// Quick Ask: as little as the model allows - it is for a quick change.
    Fast,
    /// The panel with Deep thinking off: the provider's own default, so
    /// nothing is sent.
    #[default]
    Auto,
    /// Deep thinking on: `high` where the model has levels (never `xhigh`
    /// or `max`, which cost several times as much), on where it only
    /// switches.
    Deep,
}

/// How a provider takes thinking parameters on the wire.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ThinkingFormat {
    /// None at all: nothing is ever sent, and Deep thinking isn't offered.
    None,
    /// OpenAI's: `reasoning_effort` in Chat Completions, `reasoning.effort`
    /// (and `reasoning.summary`) in the Responses API; switched off as the
    /// effort `none`. Also xAI's, Groq's, Volcengine Ark's and Ollama's
    /// OpenAI-compatible endpoints, and a custom endpoint's.
    OpenAi,
    /// Gemini's OpenAI-compatible layer (Google AI and Vertex AI):
    /// `extra_body.google.thinking_config` - `thinking_level` (Gemini 3),
    /// `thinking_budget` (2.5) and `include_thoughts`, whose thoughts come
    /// back in the reply's text between `<thought>` tags. It refuses
    /// `reasoning_effort` beside a thinking_config, so takes none.
    Gemini,
    /// Anthropic Messages: `thinking` (adaptive, disabled, or a budget on
    /// older models) and `output_config.effort`.
    Anthropic,
    /// `thinking: {type: "enabled" | "disabled"}`, plus `reasoning_effort`
    /// where the model has levels: DeepSeek, Zhipu GLM, Moonshot Kimi,
    /// MiniMax.
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
    /// `web_search` tool, used in place of Chat Completions while searching
    /// (xAI, whose Chat Completions has no such tool).
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
    /// the tool calls, for the rest of that exchange (DeepSeek and Kimi
    /// document it; pi-ai's `requiresReasoningContentOnAssistantMessages`).
    /// Anthropic's thinking blocks are always sent back - that is the
    /// Messages API's own rule, not a per-provider choice.
    pub replay_reasoning: bool,
    /// How the same key asks for a picture, where the provider makes them
    /// (aicompat::images; the image model in Settings, ai/images.rs).
    pub image: Option<ImageApi>,
    /// Chat Completions only: a streamed request may ask for its token usage
    /// (`stream_options.include_usage`). Off where a server rejects unknown
    /// fields (Mistral), doesn't document it (Zhipu) or isn't known (a
    /// custom endpoint): their usage is still read when they send it
    /// unasked.
    pub stream_usage: bool,
    /// The effort Auto asks for where the provider's own default thinks
    /// far longer than writing needs, on a model that takes that level:
    /// Ark's Seed models thought for two minutes and more on a two-paragraph
    /// edit at their default, under forty seconds at `low` (1.2.0-rc.6
    /// eval); Auto asks for `minimal`, writing rather than deliberating.
    /// None: Auto sends nothing.
    pub auto_effort: Option<&'static str>,
}

#[cfg(test)]
mod tests;
