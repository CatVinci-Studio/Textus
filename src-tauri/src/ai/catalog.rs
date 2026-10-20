//! The provider catalog: one entry per supported AI service, as data instead
//! of scattered `match provider.as_str()` special cases. `ai::route`'s
//! resolve_* functions turn an entry plus stored credentials into a concrete
//! request target.
//!
//! Mirrored on the TS side by `src/ai/provider-catalog.ts` (kept in sync by
//! hand - comments on both sides point here). Labels are brand names, shared
//! across languages, so they live here rather than in i18n - the exceptions
//! are "custom" and "doubao", whose labels the frontend localizes.

use serde::Serialize;

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCatalogEntry {
    /// Matches `Settings.aiProvider` on the TS side and the `provider`
    /// string every ai_* command dispatches on.
    pub id: &'static str,
    pub label: &'static str,
    /// The wire format this provider speaks: "openai-responses",
    /// "anthropic-messages", or "openai-chat-completions".
    pub dialect: &'static str,
    /// Auth methods the provider supports, in preference order:
    /// "oauth" (browser PKCE login), "api_key", "custom" (user-supplied
    /// endpoint config).
    pub auth: &'static [&'static str],
    /// Fixed endpoint for chat-completions providers; None when the dialect
    /// implies it (OpenAI/Anthropic) or the user supplies it ("custom").
    pub base_url: Option<&'static str>,
    /// Low-cost model used by writing completion and grammar checking until
    /// the user picks one in Settings. Agent chat has its own, generally
    /// stronger default below.
    pub default_model: Option<&'static str>,
    /// Model used by Agent chat until the user picks one in Settings. Keeping
    /// this separate from `default_model` prevents inline writing helpers
    /// from silently inheriting a more expensive Agent model.
    pub agent_default_model: Option<&'static str>,
    /// True for local servers (Ollama) that work without a key.
    pub key_optional: bool,
    /// Whether this provider's API accepts image content parts at all, which
    /// is what gates the chat's image attachments (aicompat's per-dialect
    /// `turns_to_*`). Deliberately a PROVIDER-level, not model-level, claim:
    /// whether the model the user picked can actually see is between them and
    /// the provider, and a model that can't says so in its own error. What
    /// this flag exists to prevent is offering images to an endpoint whose
    /// API rejects the request shape outright - so it is false only where
    /// that is known to be the case, and true wherever the user's own model
    /// choice decides (Ollama, custom endpoints).
    pub supports_vision: bool,
    /// False when a live GET /models call is known not to work for this
    /// provider (verified against the real endpoint - see the doc comment on
    /// `KNOWN_MODELS` below) - the frontend hides the "Fetch Models" action
    /// and relies solely on `known_models` instead of also offering a button
    /// that can only ever fail.
    pub models_listable: bool,
    /// The model ids offered before the user fetches the provider's own list:
    /// just the two defaults (agent first). Everything newer comes from the
    /// live listing (Settings' "Fetch models", tidied by aicompat::models),
    /// so this list doesn't need chasing every release - only the defaults
    /// do, and scripts/sync-models.mjs checks those weekly.
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
        // Thinks by default; agent.rs never replays thinking blocks, which
        // the preserved-thinking check always accepts (dropping all of them
        // is a "leading run"), so newer accounts can't hit its 400.
        agent_default_model: Some("claude-sonnet-5-5"),
        key_optional: false,
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
        supports_vision: true,
        // The one third-party catalog with a genuinely public /models list
        // (no key required) - still worth a known_models seed for the
        // instant-render case before that request resolves.
        models_listable: true,
        known_models: &["openrouter/auto", "openrouter/free"],
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
        // Turbo is Ark's low-latency tier; aicompat turns its thinking off
        // for writing (see custom::Vendor::Ark).
        default_model: Some("doubao-seed-2-1-turbo-260628"),
        agent_default_model: Some("doubao-seed-2-1-pro-260628"),
        key_optional: false,
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
        id: "ollama",
        label: "Ollama (local)",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("http://localhost:11434/v1"),
        default_model: None,
        agent_default_model: None,
        key_optional: true,
        supports_vision: true,
        // Whatever's installed locally, which only the user's own server
        // knows - there's no sensible fixed seed list, but the local
        // /v1/models route does work, so fetching is still worthwhile.
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
        supports_vision: true,
        models_listable: true,
        known_models: &[],
    },
];

pub fn find(id: &str) -> Option<&'static ProviderCatalogEntry> {
    PROVIDER_CATALOG.iter().find(|e| e.id == id)
}

#[tauri::command]
pub fn list_providers() -> Vec<ProviderCatalogEntry> {
    PROVIDER_CATALOG.to_vec()
}

/// Whether the chat composer offers Deep thinking for this provider and
/// Agent model (None: the provider's agent default) - aicompat's capability
/// table decides (`capabilities::can_think_deeper`). Mirrored by
/// `ai.canThinkDeeper` in platform/ipc.ts.
#[tauri::command]
pub fn ai_can_think_deeper(provider: String, model: Option<String>) -> bool {
    let Some(model) = model
        .filter(|m| !m.is_empty())
        .or_else(|| find(&provider)?.agent_default_model.map(str::to_string))
    else {
        // No model to look up (a custom endpoint's comes from its own
        // config): the table's answer for one it doesn't know.
        return aicompat::capabilities::can_think_deeper(&provider, "");
    };
    aicompat::capabilities::can_think_deeper(&provider, &model)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// scripts/sync-models.mjs's reviewed copy of what each provider serves,
    /// per models.dev. Test-only - nothing in the app reads it.
    const SNAPSHOT: &str = include_str!("../../../src/ai/models-snapshot.json");

    /// aicompat's capability table needs a row for every provider here: how
    /// it takes thinking parameters and switches on its own search. A
    /// missing row silently falls back to plain OpenAI-compatible Chat
    /// Completions, which is wrong for most named providers.
    #[test]
    fn every_provider_has_a_capability_row() {
        for entry in PROVIDER_CATALOG {
            assert!(
                aicompat::capabilities::has_row(entry.id),
                "`{}` has no row in aicompat/src/capabilities.rs",
                entry.id
            );
        }
    }

    #[test]
    fn deep_thinking_follows_the_default_agent_model() {
        assert!(ai_can_think_deeper("anthropic".into(), None));
        assert!(ai_can_think_deeper(
            "anthropic".into(),
            Some("claude-haiku-5-5".into())
        ));
        assert!(!ai_can_think_deeper("mistral".into(), None));
        assert!(!ai_can_think_deeper("openai".into(), Some("gpt-4o".into())));
    }

    /// Every model the catalog pins must still exist upstream and not be
    /// deprecated - the check that would have caught Groq's and Kimi's
    /// defaults being shut down months before anyone noticed. A failure
    /// here after a snapshot refresh means: re-pick that provider's models.
    #[test]
    fn pinned_models_are_current_per_models_dev() {
        let snapshot: serde_json::Value = serde_json::from_str(SNAPSHOT).unwrap();
        let unmapped: Vec<&str> = snapshot["unmapped"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .collect();
        for entry in PROVIDER_CATALOG {
            if unmapped.contains(&entry.id) {
                continue;
            }
            let models = &snapshot["providers"][entry.id]["models"];
            assert!(
                models.is_object(),
                "`{}` is in neither `providers` nor `unmapped` of models-snapshot.json - map it in scripts/sync-models.mjs",
                entry.id
            );
            let pinned = entry
                .default_model
                .iter()
                .chain(entry.agent_default_model.iter())
                .chain(entry.known_models.iter());
            for model in pinned {
                let found = &models[*model];
                assert!(
                    found.is_object(),
                    "{}/{model} is no longer listed by models.dev",
                    entry.id
                );
                assert_ne!(
                    found["status"], "deprecated",
                    "{}/{model} is deprecated upstream",
                    entry.id
                );
            }
        }
    }
}
