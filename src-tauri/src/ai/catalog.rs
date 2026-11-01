//! The provider catalog: one entry per supported AI service, as data. Keep in
//! step with `src/ai/provider-catalog.ts`. Labels are brand names, so they
//! live here rather than in i18n, except the few the frontend localizes.

use serde::Serialize;

#[derive(Serialize, Clone, Copy)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ProviderCatalogEntry {
    /// Matches `Settings.aiProvider` and the `provider` string every ai_*
    /// command dispatches on.
    pub id: &'static str,
    pub label: &'static str,
    /// The wire format this provider speaks: "openai-responses",
    /// "anthropic-messages", or "openai-chat-completions".
    pub dialect: &'static str,
    /// Auth methods in preference order: "oauth" (browser PKCE login),
    /// "api_key", "custom" (user-supplied endpoint config).
    pub auth: &'static [&'static str],
    /// Fixed endpoint for chat-completions providers; None when the dialect
    /// implies it (OpenAI/Anthropic) or the user supplies it ("custom").
    pub base_url: Option<&'static str>,
    /// Low-cost model for writing completion and grammar checking until the user
    /// picks one. Agent chat has its own default below.
    pub default_model: Option<&'static str>,
    /// Model used by Agent chat until the user picks one. Kept apart so inline
    /// helpers don't silently inherit a more expensive model.
    pub agent_default_model: Option<&'static str>,
    /// True for local servers (Ollama) that work without a key.
    pub key_optional: bool,
    /// Its "oauth" sign-in isn't offered to other apps; Settings says so.
    pub oauth_unofficial: bool,
    /// Whether this provider's API accepts image parts at all, which gates chat
    /// attachments. Provider-level on purpose: false only where the API rejects the
    /// request shape; a model that can't see says so in its own error.
    pub supports_vision: bool,
    /// False when a live GET /models is known not to work for this provider: the
    /// frontend then hides "Fetch Models" and relies on `known_models`.
    pub models_listable: bool,
    /// The model ids offered before the user fetches the provider's own list:
    /// just the two defaults (agent first), checked weekly by a script.
    pub known_models: &'static [&'static str],
}

pub const PROVIDER_CATALOG: &[ProviderCatalogEntry] = &[
    ProviderCatalogEntry {
        id: "openai",
        label: "OpenAI",
        dialect: "openai-responses",
        auth: &["oauth", "api_key"],
        base_url: None,
        default_model: Some("gpt-6-luna"),
        agent_default_model: Some("gpt-6.1-sol"),
        key_optional: false,
        oauth_unofficial: false,
        supports_vision: true,
        models_listable: true,
        known_models: &["gpt-6.1-sol", "gpt-6-luna"],
    },
    ProviderCatalogEntry {
        id: "anthropic",
        label: "Anthropic",
        dialect: "anthropic-messages",
        auth: &["oauth", "api_key"],
        base_url: None,
        default_model: Some("claude-haiku-5-5"),
        // Thinks by default; thinking blocks are never replayed, which the
        // preserved-thinking check always accepts, so it can't 400.
        agent_default_model: Some("claude-sonnet-5-5"),
        key_optional: false,
        oauth_unofficial: true,
        supports_vision: true,
        models_listable: true,
        known_models: &["claude-sonnet-5-5", "claude-haiku-5-5"],
    },
    ProviderCatalogEntry {
        id: "google",
        label: "Google Gemini",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://generativelanguage.googleapis.com/v1beta/openai"),
        default_model: Some("gemini-3.5-flash-lite"),
        agent_default_model: Some("gemini-3.8-flash"),
        key_optional: false,
        oauth_unofficial: false,
        supports_vision: true,
        // Gemini's OpenAI compatibility API now implements GET /models with
        // the standard OpenAI list shape, so the generic model fetch works.
        models_listable: true,
        known_models: &["gemini-3.8-flash", "gemini-3.5-flash-lite"],
    },
    ProviderCatalogEntry {
        id: "deepseek",
        label: "DeepSeek",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://api.deepseek.com/v1"),
        default_model: Some("deepseek-flash"),
        agent_default_model: Some("deepseek-v4-pro"),
        key_optional: false,
        oauth_unofficial: false,
        supports_vision: false,
        models_listable: true,
        known_models: &["deepseek-v4-pro", "deepseek-flash"],
    },
    ProviderCatalogEntry {
        id: "xai",
        label: "xAI Grok",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://api.x.ai/v1"),
        default_model: Some("grok-4.3"),
        agent_default_model: Some("grok-4.7"),
        key_optional: false,
        oauth_unofficial: false,
        supports_vision: true,
        models_listable: true,
        known_models: &["grok-4.7", "grok-4.3"],
    },
    ProviderCatalogEntry {
        id: "mistral",
        label: "Mistral",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://api.mistral.ai/v1"),
        default_model: Some("mistral-small-latest"),
        agent_default_model: Some("mistral-large-latest"),
        key_optional: false,
        oauth_unofficial: false,
        supports_vision: true,
        models_listable: true,
        known_models: &["mistral-large-latest", "mistral-small-latest"],
    },
    ProviderCatalogEntry {
        id: "groq",
        label: "Groq",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://api.groq.com/openai/v1"),
        default_model: Some("openai/gpt-oss-20b"),
        agent_default_model: Some("openai/gpt-oss-120b"),
        key_optional: false,
        oauth_unofficial: false,
        supports_vision: true,
        models_listable: true,
        known_models: &["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
    },
    ProviderCatalogEntry {
        id: "openrouter",
        label: "OpenRouter",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://openrouter.ai/api/v1"),
        default_model: Some("openrouter/free"),
        agent_default_model: Some("openrouter/auto"),
        key_optional: false,
        oauth_unofficial: false,
        supports_vision: true,
        // The one third-party catalog with a public /models list, still seeded
        // for the instant render before that request resolves.
        models_listable: true,
        known_models: &["openrouter/auto", "openrouter/free"],
    },
    ProviderCatalogEntry {
        id: "opencode-go",
        label: "OpenCode Go",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        // The subscription's OpenAI-compatible endpoint. Its MiniMax and
        // Qwen models answer only on the Anthropic-style one beside it, so
        // the models offered are the ones this endpoint serves.
        base_url: Some("https://opencode.ai/zen/go/v1"),
        default_model: Some("deepseek-v4.1-flash"),
        agent_default_model: Some("deepseek-v4-pro"),
        key_optional: false,
        oauth_unofficial: false,
        supports_vision: true,
        models_listable: true,
        known_models: &[
            "deepseek-v4-pro",
            "deepseek-v4.1-flash",
            "kimi-k2.7-code",
            "glm-5.2",
        ],
    },
    ProviderCatalogEntry {
        id: "moonshot",
        label: "Moonshot Kimi",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://api.moonshot.cn/v1"),
        default_model: Some("kimi-k2.6"),
        agent_default_model: Some("kimi-k3"),
        key_optional: false,
        oauth_unofficial: false,
        supports_vision: true,
        models_listable: true,
        known_models: &["kimi-k3", "kimi-k2.6"],
    },
    ProviderCatalogEntry {
        id: "zhipu",
        label: "Zhipu GLM",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://open.bigmodel.cn/api/paas/v4"),
        default_model: Some("glm-4.7-flash"),
        agent_default_model: Some("glm-5.3"),
        key_optional: false,
        oauth_unofficial: false,
        supports_vision: true,
        models_listable: true,
        known_models: &["glm-5.3", "glm-4.7-flash"],
    },
    ProviderCatalogEntry {
        id: "qwen",
        label: "Alibaba Qwen",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://dashscope.aliyuncs.com/compatible-mode/v1"),
        default_model: Some("qwen3.8-flash"),
        agent_default_model: Some("qwen3.7-plus"),
        key_optional: false,
        oauth_unofficial: false,
        supports_vision: true,
        models_listable: true,
        known_models: &["qwen3.7-plus", "qwen3.8-flash"],
    },
    ProviderCatalogEntry {
        id: "doubao",
        // "豆包（火山引擎）" in Chinese - the frontend localizes it.
        label: "Doubao (Volcengine)",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        // Volcengine Ark. With an API key, `model` takes the Model ID
        // itself, so no inference endpoint (ep-...) has to be created first.
        base_url: Some("https://ark.cn-beijing.volces.com/api/v3"),
        // Turbo is Ark's low-latency tier; its thinking is turned off for writing.
        default_model: Some("doubao-seed-2-1-turbo-260628"),
        agent_default_model: Some("doubao-seed-2-1-pro-260628"),
        key_optional: false,
        oauth_unofficial: false,
        // Every current Seed model reads images.
        supports_vision: true,
        models_listable: true,
        // Plus Ark's rolling id, which always serves the newest Seed model
        // without a date-suffixed name to chase.
        known_models: &[
            "doubao-seed-2-1-pro-260628",
            "doubao-seed-2-1-turbo-260628",
            "doubao-seed-evolving",
        ],
    },
    ProviderCatalogEntry {
        id: "minimax",
        // The China platform (minimaxi.com); its keys don't work on the
        // global one below, nor the other way round.
        label: "MiniMax (China)",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://api.minimaxi.com/v1"),
        default_model: Some("MiniMax-M3.1-Flash"),
        agent_default_model: Some("MiniMax-M3"),
        key_optional: false,
        oauth_unofficial: false,
        // Its Chat Completions takes text only.
        supports_vision: false,
        models_listable: true,
        known_models: &["MiniMax-M3", "MiniMax-M3.1-Flash"],
    },
    ProviderCatalogEntry {
        id: "minimax-intl",
        label: "MiniMax (Global)",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://api.minimax.io/v1"),
        default_model: Some("MiniMax-M3.1-Flash"),
        agent_default_model: Some("MiniMax-M3"),
        key_optional: false,
        oauth_unofficial: false,
        supports_vision: false,
        models_listable: true,
        known_models: &["MiniMax-M3", "MiniMax-M3.1-Flash"],
    },
    ProviderCatalogEntry {
        id: "ollama",
        label: "Ollama (local)",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("http://localhost:11434/v1"),
        default_model: None,
        agent_default_model: None,
        key_optional: true,
        oauth_unofficial: false,
        supports_vision: true,
        // Whatever's installed locally: no fixed seed list, but the local
        // /v1/models route works.
        models_listable: true,
        known_models: &[],
    },
    ProviderCatalogEntry {
        id: "custom",
        label: "Custom Endpoint",
        dialect: "openai-chat-completions",
        auth: &["custom"],
        base_url: None,
        default_model: None,
        agent_default_model: None,
        key_optional: true,
        oauth_unofficial: false,
        supports_vision: true,
        models_listable: true,
        known_models: &[],
    },
];

pub fn find(id: &str) -> Option<&'static ProviderCatalogEntry> {
    PROVIDER_CATALOG.iter().find(|e| e.id == id)
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn list_providers() -> Vec<ProviderCatalogEntry> {
    PROVIDER_CATALOG.to_vec()
}

/// Whether the chat composer offers Deep thinking for this provider and
/// Agent model (None: the provider's agent default).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn ai_can_think_deeper(provider: String, model: Option<String>) -> bool {
    let Some(model) = model
        .filter(|m| !m.is_empty())
        .or_else(|| find(&provider)?.agent_default_model.map(str::to_string))
    else {
        // No model to look up (a custom endpoint's comes from its config): the
        // table's answer for one it doesn't know.
        return aicompat::capabilities::can_think_deeper(&provider, "");
    };
    aicompat::capabilities::can_think_deeper(&provider, &model)
}

#[cfg(test)]
mod tests;
