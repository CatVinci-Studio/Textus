//! What each provider takes, one row per provider id, and which search
//! route a model of it uses.

use super::*;

/// A provider id the table doesn't list - a newly added catalog entry, or
/// "custom" - speaks plain OpenAI-compatible Chat Completions.
pub(crate) const DEFAULT_CAPS: ProviderCaps = ProviderCaps {
    auto_effort: None,
    thinking: ThinkingFormat::OpenAi,
    native_search: NativeSearch::None,
    replay_reasoning: false,
    image: None,
    stream_usage: false,
};

pub(crate) const PROVIDERS: &[(&str, ProviderCaps)] = &[
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
    (
        "google",
        ProviderCaps {
            auto_effort: None,
            thinking: ThinkingFormat::Gemini,
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
            auto_effort: Some("minimal"),
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
pub(crate) fn qwen_uses_responses_search(model: &str) -> bool {
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
