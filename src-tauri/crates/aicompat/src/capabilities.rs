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
    /// effort `none`. Also Gemini's, xAI's, Groq's, Volcengine Ark's and
    /// Ollama's OpenAI-compatible endpoints, and a custom endpoint's.
    OpenAi,
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
    /// edit at their default, under forty seconds at `low`, as right
    /// (1.2.0-rc.6 tag eval). None: Auto sends nothing.
    pub auto_effort: Option<&'static str>,
}

/// A provider id the table doesn't list - a newly added catalog entry, or
/// "custom" - speaks plain OpenAI-compatible Chat Completions.
const DEFAULT_CAPS: ProviderCaps = ProviderCaps {
    auto_effort: None,
    thinking: ThinkingFormat::OpenAi,
    native_search: NativeSearch::None,
    replay_reasoning: false,
    image: None,
    stream_usage: false,
};

const PROVIDERS: &[(&str, ProviderCaps)] = &[
    (
        "openai",
        ProviderCaps {
            auto_effort: None,
            thinking: ThinkingFormat::OpenAi,
            native_search: NativeSearch::ResponsesTool,
            replay_reasoning: false,
            stream_usage: true,
            image: Some(ImageApi::OpenAi),
        },
    ),
    (
        "anthropic",
        ProviderCaps {
            auto_effort: None,
            thinking: ThinkingFormat::Anthropic,
            native_search: NativeSearch::AnthropicTool,
            replay_reasoning: false,
            stream_usage: true,
            image: None,
        },
    ),
    // Gemini's OpenAI compatibility layer maps `reasoning_effort` onto its
    // thinkingConfig (thinkingLevel on Gemini 3, a budget on 2.5).
    (
        "google",
        ProviderCaps {
            auto_effort: None,
            image: Some(ImageApi::Gemini),
            stream_usage: true,
            ..DEFAULT_CAPS
        },
    ),
    (
        "deepseek",
        ProviderCaps {
            auto_effort: None,
            thinking: ThinkingFormat::ThinkingType,
            native_search: NativeSearch::None,
            replay_reasoning: true,
            stream_usage: true,
            image: None,
        },
    ),
    (
        "xai",
        ProviderCaps {
            auto_effort: None,
            thinking: ThinkingFormat::OpenAi,
            native_search: NativeSearch::CompatibleResponses,
            replay_reasoning: false,
            stream_usage: true,
            image: None,
        },
    ),
    // Mistral rejects unknown fields, and none of its chat models think.
    (
        "mistral",
        ProviderCaps {
            auto_effort: None,
            thinking: ThinkingFormat::None,
            native_search: NativeSearch::None,
            replay_reasoning: false,
            stream_usage: false,
            image: None,
        },
    ),
    (
        "groq",
        ProviderCaps {
            auto_effort: None,
            thinking: ThinkingFormat::OpenAi,
            native_search: NativeSearch::ChatCompletions(NativeWebSearch::Groq),
            replay_reasoning: false,
            stream_usage: true,
            image: None,
        },
    ),
    (
        "openrouter",
        ProviderCaps {
            auto_effort: None,
            thinking: ThinkingFormat::OpenRouter,
            native_search: NativeSearch::ChatCompletions(NativeWebSearch::OpenRouter),
            replay_reasoning: false,
            stream_usage: true,
            image: None,
        },
    ),
    (
        "moonshot",
        ProviderCaps {
            auto_effort: None,
            thinking: ThinkingFormat::ThinkingType,
            native_search: NativeSearch::None,
            replay_reasoning: true,
            stream_usage: true,
            image: None,
        },
    ),
    (
        "zhipu",
        ProviderCaps {
            auto_effort: None,
            thinking: ThinkingFormat::ThinkingType,
            native_search: NativeSearch::ChatCompletions(NativeWebSearch::Zhipu),
            replay_reasoning: true,
            stream_usage: false,
            image: Some(ImageApi::Zhipu),
        },
    ),
    (
        "qwen",
        ProviderCaps {
            auto_effort: None,
            thinking: ThinkingFormat::Qwen,
            native_search: NativeSearch::Qwen,
            replay_reasoning: false,
            stream_usage: true,
            image: Some(ImageApi::DashScope),
        },
    ),
    // MiniMax: M3 switches thinking on and off, M3.1 Flash only takes an
    // effort (model-capabilities.json); custom::Vendor::MiniMax keeps the
    // thinking out of the answer.
    (
        "minimax",
        ProviderCaps {
            auto_effort: None,
            thinking: ThinkingFormat::ThinkingType,
            native_search: NativeSearch::None,
            replay_reasoning: false,
            stream_usage: true,
            image: Some(ImageApi::MiniMax),
        },
    ),
    (
        "minimax-intl",
        ProviderCaps {
            auto_effort: None,
            thinking: ThinkingFormat::ThinkingType,
            native_search: NativeSearch::None,
            replay_reasoning: false,
            stream_usage: true,
            image: Some(ImageApi::MiniMax),
        },
    ),
    // Ark takes `reasoning_effort` (`none` to `max` on Seed) and maps it
    // onto the models that only switch, where `thinking.type: disabled`
    // can be refused (custom::Vendor::Ark).
    (
        "doubao",
        ProviderCaps {
            auto_effort: Some("low"),
            thinking: ThinkingFormat::OpenAi,
            native_search: NativeSearch::None,
            replay_reasoning: true,
            stream_usage: true,
            image: Some(ImageApi::Seedream),
        },
    ),
    // Ollama's /v1 endpoint takes `reasoning_effort` and maps it onto its
    // own `think`.
    (
        "ollama",
        ProviderCaps {
            auto_effort: None,
            stream_usage: true,
            ..DEFAULT_CAPS
        },
    ),
    ("custom", DEFAULT_CAPS),
];

/// The provider's row, or the plain OpenAI-compatible default.
pub fn provider(id: &str) -> ProviderCaps {
    PROVIDERS
        .iter()
        .find(|(p, _)| *p == id)
        .map(|(_, caps)| *caps)
        .unwrap_or(DEFAULT_CAPS)
}

/// Whether the table has a row of its own for `id` (catalog.rs's tests
/// require one for every catalog entry).
pub fn has_row(id: &str) -> bool {
    PROVIDERS.iter().any(|(p, _)| *p == id)
}

/// Alibaba exposes web search for newer Qwen generations through its
/// OpenAI-compatible Responses API; older qwen-plus/flash models keep the
/// Chat Completions `enable_search` switch.
fn qwen_uses_responses_search(model: &str) -> bool {
    ["qwen3.8-", "qwen3.7-", "qwen3.6-", "qwen3.5-", "qwen3-max"]
        .iter()
        .any(|prefix| model.starts_with(prefix))
}

/// How `provider`'s native search is switched on for `model` - never
/// [`NativeSearch::Qwen`], which is resolved here.
pub fn search_route(provider_id: &str, model: &str) -> NativeSearch {
    match provider(provider_id).native_search {
        NativeSearch::Qwen if qwen_uses_responses_search(model) => {
            NativeSearch::CompatibleResponses
        }
        NativeSearch::Qwen => NativeSearch::ChatCompletions(NativeWebSearch::Qwen),
        route => route,
    }
}

/// What a model's thinking takes, per models.dev.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ModelReasoning {
    /// Not in the table: a custom endpoint, Ollama, OpenRouter's routers, a
    /// model newer than the last sync.
    Unknown,
    /// Doesn't reason.
    No,
    /// Reasons, and takes no setting.
    Fixed,
    Options {
        /// Can be switched off.
        toggle: bool,
        /// The effort levels it accepts, lowest first.
        efforts: Vec<String>,
        /// Takes a thinking-token budget, up to this many.
        budget: Option<u64>,
    },
}

#[derive(Deserialize)]
struct CapabilityFile {
    providers: HashMap<String, HashMap<String, ModelEntry>>,
}

#[derive(Deserialize)]
struct ModelEntry {
    reasoning: Value,
}

fn table() -> &'static HashMap<String, HashMap<String, ModelEntry>> {
    static TABLE: OnceLock<HashMap<String, HashMap<String, ModelEntry>>> = OnceLock::new();
    TABLE.get_or_init(|| {
        serde_json::from_str::<CapabilityFile>(include_str!("../data/model-capabilities.json"))
            .map(|file| file.providers)
            .unwrap_or_default()
    })
}

fn parse_reasoning(value: &Value) -> ModelReasoning {
    match value {
        Value::Bool(false) => ModelReasoning::No,
        Value::Object(options) => ModelReasoning::Options {
            toggle: options.get("toggle").and_then(Value::as_bool) == Some(true),
            efforts: options
                .get("effort")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default(),
            budget: options
                .get("budget")
                .map(|b| b.as_u64().unwrap_or(u64::MAX)),
        },
        _ => ModelReasoning::Fixed,
    }
}

pub fn model_reasoning(provider_id: &str, model: &str) -> ModelReasoning {
    table()
        .get(provider_id)
        .and_then(|models| models.get(model))
        .map(|entry| parse_reasoning(&entry.reasoning))
        .unwrap_or(ModelReasoning::Unknown)
}

/// Whether Deep thinking would change anything for this model - what shows
/// the composer's button. Off for a model that doesn't think, or thinks one
/// fixed way; on for one the table doesn't know, where the parameters are
/// tried and dropped if refused.
pub fn can_think_deeper(provider_id: &str, model: &str) -> bool {
    if provider(provider_id).thinking == ThinkingFormat::None {
        return false;
    }
    match model_reasoning(provider_id, model) {
        ModelReasoning::Unknown => true,
        ModelReasoning::No | ModelReasoning::Fixed => false,
        ModelReasoning::Options {
            toggle,
            efforts,
            budget,
        } => toggle || budget.is_some() || efforts.len() > 1,
    }
}

/// The thinking-token budget Deep asks for where a model takes a budget
/// rather than levels (Qwen, older Claude). A starting value, to be tuned
/// with the live eval.
pub const DEEP_BUDGET: u32 = 16_384;

/// One request's thinking parameters, dialect-neutral; each dialect renders
/// the parts it has a field for (`apply_*`). Empty for Auto: nothing sent.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Thinking {
    pub format: Option<ThinkingFormat>,
    /// Switch thinking on or off, where the model can.
    pub on: Option<bool>,
    pub effort: Option<String>,
    pub budget: Option<u32>,
    /// Ask for readable reasoning (OpenAI's summary, Claude's summarized
    /// display) - what the "Thinking" row can show.
    pub show: bool,
    /// See [`ProviderCaps::replay_reasoning`].
    pub replay: bool,
    /// Live eval only: opt the Claude request into the preserved-thinking
    /// check (`block_binding: error`), so a thinking block replayed after a
    /// history edit fails the run instead of being let through on an
    /// account created before the check was enforced.
    pub enforce_binding: bool,
}

impl Thinking {
    /// Whether any parameter would be sent.
    pub fn sends_parameters(&self) -> bool {
        self.on.is_some() || self.effort.is_some() || self.budget.is_some() || self.show
    }

    /// The same request with no thinking parameters - what a provider that
    /// refused them gets.
    pub fn without_parameters(&self) -> Thinking {
        Thinking {
            format: self.format,
            replay: self.replay,
            ..Thinking::default()
        }
    }

    /// Chat Completions: the format's fields, on the top level of `body`.
    pub fn apply_chat_completions(&self, body: &mut Value) {
        match self.format {
            Some(ThinkingFormat::OpenAi) => {
                if let Some(effort) = self.wire_effort() {
                    body["reasoning_effort"] = json!(effort);
                }
            }
            Some(ThinkingFormat::ThinkingType) => {
                if let Some(on) = self.on {
                    body["thinking"] = json!({"type": if on { "enabled" } else { "disabled" }});
                }
                if self.on != Some(false) {
                    if let Some(effort) = &self.effort {
                        body["reasoning_effort"] = json!(effort);
                    }
                }
            }
            Some(ThinkingFormat::Qwen) => self.apply_qwen(body),
            Some(ThinkingFormat::OpenRouter) => {
                if self.on == Some(false) {
                    body["reasoning"] = json!({"enabled": false});
                } else if let Some(effort) = &self.effort {
                    body["reasoning"] = json!({"effort": effort});
                } else if self.on == Some(true) {
                    body["reasoning"] = json!({"enabled": true});
                }
            }
            Some(ThinkingFormat::Anthropic | ThinkingFormat::None) | None => {}
        }
    }

    /// Responses API (OpenAI's, and the compatible `/responses` of xAI and
    /// Qwen): `reasoning.effort`, with `reasoning.summary` when the
    /// reasoning should be readable. Qwen keeps its own switch there too.
    pub fn apply_responses(&self, body: &mut Value) {
        if self.format == Some(ThinkingFormat::Qwen) {
            self.apply_qwen(body);
            return;
        }
        if !matches!(self.format, Some(ThinkingFormat::OpenAi)) {
            return;
        }
        let mut reasoning = serde_json::Map::new();
        if let Some(effort) = self.wire_effort() {
            reasoning.insert("effort".into(), json!(effort));
        }
        if self.show {
            reasoning.insert("summary".into(), json!("auto"));
        }
        if !reasoning.is_empty() {
            body["reasoning"] = Value::Object(reasoning);
        }
    }

    /// Anthropic Messages: `thinking` and `output_config.effort`, plus room
    /// in `max_tokens` for what the thinking itself uses. Returns whether
    /// the request needs the preserved-thinking controls beta header.
    pub fn apply_anthropic(&self, body: &mut Value) -> bool {
        if self.format != Some(ThinkingFormat::Anthropic) {
            return false;
        }
        if self.on == Some(false) {
            body["thinking"] = json!({"type": "disabled"});
            return false;
        }
        let mut thinking = None;
        if let Some(budget) = self.budget {
            // Older models: a fixed budget, which max_tokens must exceed.
            thinking = Some(json!({"type": "enabled", "budget_tokens": budget}));
            let max = body["max_tokens"].as_u64().unwrap_or(0);
            body["max_tokens"] = json!(max + u64::from(budget));
        } else if self.show || self.effort.is_some() || self.enforce_binding {
            let mut adaptive = json!({"type": "adaptive"});
            if self.show {
                adaptive["display"] = json!("summarized");
            }
            thinking = Some(adaptive);
        }
        if let Some(effort) = &self.effort {
            body["output_config"] = json!({"effort": effort});
        }
        let enforce = self.enforce_binding && thinking.is_some() && self.budget.is_none();
        if let Some(mut thinking) = thinking {
            if enforce {
                thinking["block_binding"] = json!({"prefix_mismatch_behavior": "error"});
            }
            body["thinking"] = thinking;
        }
        enforce
    }

    fn apply_qwen(&self, body: &mut Value) {
        if let Some(on) = self.on {
            body["enable_thinking"] = json!(on);
        }
        if self.on != Some(false) {
            if let Some(budget) = self.budget {
                body["thinking_budget"] = json!(budget);
            }
        }
    }

    /// The effort as an OpenAI-format field: switching off is `none`.
    fn wire_effort(&self) -> Option<&str> {
        match (self.on, &self.effort) {
            (Some(false), _) => Some("none"),
            (_, Some(effort)) => Some(effort),
            _ => None,
        }
    }
}

/// The beta header that lets a Claude request set `block_binding`.
pub const THINKING_BINDING_BETA: &str = "thinking-binding-controls-2026-08-01";

/// The effort Deep asks for: `high`, or the strongest level below `xhigh`
/// the model has.
fn deep_effort(efforts: &[String]) -> Option<String> {
    if efforts.iter().any(|e| e == "high") {
        return Some("high".into());
    }
    efforts
        .iter()
        .rfind(|e| !matches!(e.as_str(), "none" | "xhigh" | "max"))
        .cloned()
}

/// What `level` sends to `model` on `provider_id`. Nothing for Auto, for a
/// format that takes nothing, and for a model that refused thinking
/// parameters earlier this session.
pub fn plan(provider_id: &str, model: &str, level: ThinkingLevel) -> Thinking {
    let caps = provider(provider_id);
    let base = Thinking {
        format: Some(caps.thinking),
        replay: caps.replay_reasoning,
        ..Thinking::default()
    };
    if caps.thinking == ThinkingFormat::None || refused(provider_id, model) {
        return base;
    }
    let reasoning = model_reasoning(provider_id, model);
    if level == ThinkingLevel::Auto {
        return match (caps.auto_effort, &reasoning) {
            (Some(effort), ModelReasoning::Options { efforts, .. })
                if efforts.iter().any(|e| e == effort) =>
            {
                Thinking {
                    effort: Some(effort.into()),
                    ..base
                }
            }
            _ => base,
        };
    }
    match (level, reasoning) {
        (_, ModelReasoning::No | ModelReasoning::Fixed) => base,
        // Unknown: Fast leaves the provider's default alone; Deep asks the
        // way the provider's format usually takes it.
        (ThinkingLevel::Fast, ModelReasoning::Unknown) => base,
        (_, ModelReasoning::Unknown) => match caps.thinking {
            ThinkingFormat::ThinkingType | ThinkingFormat::Qwen => Thinking {
                on: Some(true),
                ..base
            },
            _ => Thinking {
                effort: Some("high".into()),
                show: true,
                ..base
            },
        },
        (
            ThinkingLevel::Fast,
            ModelReasoning::Options {
                toggle, efforts, ..
            },
        ) => {
            // Off where the model can be switched off, by the switch or
            // as the effort `none`.
            if toggle || efforts.iter().any(|e| e == "none") {
                Thinking {
                    on: Some(false),
                    ..base
                }
            } else {
                Thinking {
                    effort: efforts.first().cloned(),
                    ..base
                }
            }
        }
        (
            _,
            ModelReasoning::Options {
                toggle,
                efforts,
                budget,
            },
        ) => {
            let effort = deep_effort(&efforts);
            // A budget only where there is no level to ask for (or the
            // format has no field for levels): Qwen, and pre-adaptive Claude.
            let budget = budget
                .filter(|_| effort.is_none() || caps.thinking == ThinkingFormat::Qwen)
                .map(|max| u64::from(DEEP_BUDGET).min(max) as u32);
            Thinking {
                on: toggle.then_some(true),
                effort,
                budget,
                show: true,
                ..base
            }
        }
    }
}

fn refusals() -> &'static Mutex<HashSet<String>> {
    static REFUSED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    REFUSED.get_or_init(Default::default)
}

fn refused(provider_id: &str, model: &str) -> bool {
    refusals()
        .lock()
        .map(|set| set.contains(&format!("{provider_id}/{model}")))
        .unwrap_or(false)
}

fn remember_refusal(provider_id: &str, model: &str) {
    if let Ok(mut set) = refusals().lock() {
        set.insert(format!("{provider_id}/{model}"));
    }
}

/// Whether a failed request's error reads as the provider refusing a
/// thinking parameter: a 400 (or 422) whose body names one. Error strings
/// are the dialects' `"... request failed ({status}): {body}"`.
pub fn is_thinking_refusal(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    let rejected = ["(400", "(422"].iter().any(|s| lower.contains(s));
    rejected
        && [
            "reasoning",
            "thinking",
            "effort",
            "output_config",
            "budget",
            "summary",
        ]
        .iter()
        .any(|field| lower.contains(field))
}

/// Runs `step` with `thinking`; when the provider refuses the parameters,
/// runs it once more without them and stops sending them to this model for
/// the rest of the session - so a model the table is wrong about costs one
/// failed request, not a broken chat.
pub async fn with_fallback<T, F, Fut>(
    provider_id: &str,
    model: &str,
    thinking: &Thinking,
    mut step: F,
) -> Result<T, String>
where
    F: FnMut(Thinking) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    match step(thinking.clone()).await {
        Err(error) if thinking.sends_parameters() && is_thinking_refusal(&error) => {
            remember_refusal(provider_id, model);
            step(thinking.without_parameters()).await
        }
        result => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn efforts(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| v.to_string()).collect()
    }

    #[test]
    fn the_generated_table_knows_the_pinned_models() {
        assert_eq!(
            model_reasoning("anthropic", "claude-haiku-5-5"),
            ModelReasoning::Options {
                toggle: true,
                efforts: efforts(&["low", "medium", "high", "xhigh", "max"]),
                budget: None,
            }
        );
        assert_eq!(
            model_reasoning("mistral", "mistral-large-latest"),
            ModelReasoning::No
        );
        assert_eq!(
            model_reasoning("custom", "my-model"),
            ModelReasoning::Unknown
        );
    }

    #[test]
    fn deep_thinking_is_offered_only_where_it_changes_something() {
        assert!(can_think_deeper("anthropic", "claude-sonnet-5-5"));
        assert!(can_think_deeper("deepseek", "deepseek-v4-pro"));
        assert!(can_think_deeper("zhipu", "glm-4.7-flash"));
        assert!(can_think_deeper("ollama", "qwen3:8b"));
        assert!(!can_think_deeper("mistral", "mistral-large-latest"));
        assert!(!can_think_deeper("openai", "gpt-4o"));
    }

    #[test]
    fn streamed_usage_is_asked_for_only_where_the_server_takes_it() {
        assert!(provider("deepseek").stream_usage && provider("doubao").stream_usage);
        assert!(!provider("mistral").stream_usage, "rejects unknown fields");
        assert!(!provider("custom").stream_usage && !provider("new-entry").stream_usage);
    }

    #[test]
    fn auto_sends_nothing() {
        for (provider, model) in [
            ("openai", "gpt-6.1-sol"),
            ("anthropic", "claude-sonnet-5-5"),
            ("deepseek", "deepseek-v4-pro"),
            ("qwen", "qwen3.7-plus"),
        ] {
            assert!(!plan(provider, model, ThinkingLevel::Auto).sends_parameters());
        }
    }

    #[test]
    fn auto_turns_ark_down_to_low_where_the_model_takes_it() {
        let seed = plan("doubao", "doubao-seed-2-1-pro-260628", ThinkingLevel::Auto);
        assert_eq!(seed.effort.as_deref(), Some("low"));
        // Deep still asks for more.
        assert_eq!(
            plan("doubao", "doubao-seed-2-1-pro-260628", ThinkingLevel::Deep)
                .effort
                .as_deref(),
            Some("high")
        );
        // A model the table doesn't know: the provider's default.
        assert!(!plan("doubao", "doubao-unknown", ThinkingLevel::Auto).sends_parameters());
    }

    #[test]
    fn deep_asks_for_high_never_xhigh_or_max() {
        assert_eq!(
            plan("openai", "gpt-6.1-sol", ThinkingLevel::Deep).effort,
            Some("high".into())
        );
        assert_eq!(
            deep_effort(&efforts(&["low", "medium", "xhigh"])),
            Some("medium".into())
        );
        assert_eq!(
            deep_effort(&efforts(&["low", "high", "max"])),
            Some("high".into())
        );
    }

    #[test]
    fn fast_turns_thinking_off_or_down_as_far_as_the_model_allows() {
        // Luna can be switched off; Sol bottoms out at low.
        let luna = plan("openai", "gpt-6-luna", ThinkingLevel::Fast);
        assert_eq!(luna.on, Some(false));
        let sol = plan("openai", "gpt-6.1-sol", ThinkingLevel::Fast);
        assert_eq!(sol.effort.as_deref(), Some("low"));
        // Haiku 5.5 switches off; Sonnet 5.5 can't, so low effort.
        assert_eq!(
            plan("anthropic", "claude-haiku-5-5", ThinkingLevel::Fast).on,
            Some(false)
        );
        assert_eq!(
            plan("anthropic", "claude-sonnet-5-5", ThinkingLevel::Fast)
                .effort
                .as_deref(),
            Some("low")
        );
        // A model the table doesn't know keeps its default.
        assert!(!plan("custom", "local", ThinkingLevel::Fast).sends_parameters());
    }

    fn chat_body(thinking: &Thinking) -> Value {
        let mut body = json!({"model": "m"});
        thinking.apply_chat_completions(&mut body);
        body
    }

    #[test]
    fn each_chat_completions_format_has_its_own_fields() {
        let openai = chat_body(&plan("groq", "openai/gpt-oss-120b", ThinkingLevel::Deep));
        assert_eq!(openai["reasoning_effort"], "high");

        let deepseek = chat_body(&plan("deepseek", "deepseek-v4-pro", ThinkingLevel::Deep));
        assert_eq!(deepseek["thinking"]["type"], "enabled");
        assert_eq!(deepseek["reasoning_effort"], "high");
        let deepseek_fast = chat_body(&plan("deepseek", "deepseek-v4-pro", ThinkingLevel::Fast));
        assert_eq!(deepseek_fast["thinking"]["type"], "disabled");
        assert!(deepseek_fast.get("reasoning_effort").is_none());

        let qwen = chat_body(&plan("qwen", "qwen3.7-plus", ThinkingLevel::Deep));
        assert_eq!(qwen["enable_thinking"], true);
        assert_eq!(qwen["thinking_budget"], DEEP_BUDGET);
        let qwen_fast = chat_body(&plan("qwen", "qwen3.8-flash", ThinkingLevel::Fast));
        assert_eq!(qwen_fast["enable_thinking"], false);
        assert!(qwen_fast.get("thinking_budget").is_none());

        let glm = chat_body(&plan("zhipu", "glm-4.7-flash", ThinkingLevel::Deep));
        assert_eq!(glm["thinking"]["type"], "enabled");
        let kimi = chat_body(&plan("moonshot", "kimi-k3", ThinkingLevel::Deep));
        assert_eq!(kimi["reasoning_effort"], "high");

        let router = chat_body(&plan("openrouter", "openrouter/auto", ThinkingLevel::Deep));
        assert_eq!(router["reasoning"]["effort"], "high");

        let gemini = chat_body(&plan("google", "gemini-3.8-flash", ThinkingLevel::Fast));
        assert_eq!(gemini["reasoning_effort"], "low");

        let mistral = chat_body(&plan(
            "mistral",
            "mistral-large-latest",
            ThinkingLevel::Deep,
        ));
        assert_eq!(mistral, json!({"model": "m"}));
    }

    #[test]
    fn responses_requests_ask_for_a_summary_when_deep() {
        let mut body = json!({});
        plan("openai", "gpt-6.1-sol", ThinkingLevel::Deep).apply_responses(&mut body);
        assert_eq!(
            body["reasoning"],
            json!({"effort": "high", "summary": "auto"})
        );
        let mut fast = json!({});
        plan("openai", "gpt-6-luna", ThinkingLevel::Fast).apply_responses(&mut fast);
        assert_eq!(fast["reasoning"], json!({"effort": "none"}));
    }

    #[test]
    fn claude_gets_adaptive_thinking_and_an_effort() {
        let mut deep = json!({"max_tokens": 16384});
        let beta =
            plan("anthropic", "claude-sonnet-5-5", ThinkingLevel::Deep).apply_anthropic(&mut deep);
        assert!(!beta);
        assert_eq!(
            deep["thinking"],
            json!({"type": "adaptive", "display": "summarized"})
        );
        assert_eq!(deep["output_config"]["effort"], "high");

        let mut fast = json!({"max_tokens": 16384});
        plan("anthropic", "claude-haiku-5-5", ThinkingLevel::Fast).apply_anthropic(&mut fast);
        assert_eq!(fast["thinking"], json!({"type": "disabled"}));
        assert!(fast.get("output_config").is_none());

        // A budget model: max_tokens grows by the budget it must exceed.
        let old = Thinking {
            format: Some(ThinkingFormat::Anthropic),
            budget: Some(DEEP_BUDGET),
            show: true,
            ..Thinking::default()
        };
        let mut body = json!({"max_tokens": 16384});
        old.apply_anthropic(&mut body);
        assert_eq!(body["thinking"]["budget_tokens"], DEEP_BUDGET);
        assert_eq!(body["max_tokens"], 16384 + DEEP_BUDGET);

        let mut auto = json!({"max_tokens": 16384});
        plan("anthropic", "claude-sonnet-5-5", ThinkingLevel::Auto).apply_anthropic(&mut auto);
        assert_eq!(auto, json!({"max_tokens": 16384}));
    }

    #[test]
    fn a_refused_parameter_is_retried_without_and_not_sent_again() {
        let thinking = plan("custom", "refuses-effort", ThinkingLevel::Deep);
        assert!(thinking.sends_parameters());
        let sent = std::cell::RefCell::new(Vec::new());
        let result = tauri::async_runtime::block_on(with_fallback(
            "custom",
            "refuses-effort",
            &thinking,
            |t| {
                sent.borrow_mut().push(t.sends_parameters());
                async move {
                    if t.sends_parameters() {
                        Err("Custom endpoint request failed (400 Bad Request): {\"error\":\"Unrecognized request argument supplied: reasoning_effort\"}".to_string())
                    } else {
                        Ok("answer")
                    }
                }
            },
        ));
        assert_eq!(result.unwrap(), "answer");
        assert_eq!(*sent.borrow(), [true, false]);
        assert!(!plan("custom", "refuses-effort", ThinkingLevel::Deep).sends_parameters());
    }

    #[test]
    fn qwen_search_endpoint_tracks_model_generation() {
        for model in ["qwen3.7-plus", "qwen3.5-flash", "qwen3-max"] {
            assert_eq!(
                search_route("qwen", model),
                NativeSearch::CompatibleResponses
            );
        }
        for model in ["qwen-plus", "qwen-flash"] {
            assert_eq!(
                search_route("qwen", model),
                NativeSearch::ChatCompletions(NativeWebSearch::Qwen)
            );
        }
        assert_eq!(
            search_route("xai", "grok-4.7"),
            NativeSearch::CompatibleResponses
        );
        assert_eq!(
            search_route("deepseek", "deepseek-v4-pro"),
            NativeSearch::None
        );
    }

    #[test]
    fn other_errors_are_not_mistaken_for_a_refusal() {
        assert!(!is_thinking_refusal(
            "Claude request failed (429 Too Many Requests): rate limited"
        ));
        assert!(!is_thinking_refusal(
            "Claude request failed (400 Bad Request): prompt is too long"
        ));
        assert!(is_thinking_refusal(
            "Claude request failed (400 Bad Request): thinking.type: disabled is not supported"
        ));
    }
}
