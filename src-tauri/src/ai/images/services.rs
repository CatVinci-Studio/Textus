//! The image services Settings offers, the one a chat provider brings
//! with it, and the setting as a request carries it.

use super::*;

/// One service Settings › Textus AI › Image model offers. Mirrored by
/// `ImageProviderEntry` in src/ai/image-models.ts.
#[derive(Serialize, Clone, Copy)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ImageProviderEntry {
    pub id: &'static str,
    /// A brand name; "custom", "doubao" and MiniMax's two are localized by
    /// the frontend.
    pub label: &'static str,
    pub api: ImageApi,
    /// None for the compatible endpoint, whose address the user gives.
    pub base_url: Option<&'static str>,
    /// Where the key is kept (auth::keys). The chat provider's own id
    /// wherever the same key works for both, so a provider already set up
    /// for chat needs no second key.
    pub key_id: &'static str,
    /// The models offered, the default first; the compatible endpoint's is
    /// typed in.
    pub models: &'static [&'static str],
    /// The chat provider whose sign-in brings this service, which then
    /// follows that chat rather than the provider's own pictures on its key.
    pub sign_in_for: Option<&'static str>,
}

pub const IMAGE_PROVIDERS: &[ImageProviderEntry] = &[
    ImageProviderEntry {
        // The ChatGPT sign-in's own pictures, on the plan's allowance:
        // experimental, since it is the backend ChatGPT's apps use, not a
        // published API (aicompat openai_codex::generate_image).
        id: "openai-chatgpt",
        label: "OpenAI (ChatGPT sign-in)",
        api: ImageApi::ChatGpt,
        base_url: None,
        // No key: the sign-in's credential, which Settings › Textus AI
        // keeps under the chat provider.
        key_id: "",
        models: &["gpt-image"],
        sign_in_for: Some("openai"),
    },
    ImageProviderEntry {
        id: "openai",
        label: "OpenAI",
        api: ImageApi::OpenAi,
        base_url: Some("https://api.openai.com/v1"),
        // An API key: the ChatGPT sign-in has no Images API.
        key_id: "openai",
        // About $0.05 and $0.01 a picture at medium quality (2026-10).
        models: &["gpt-image-2", "gpt-image-1-mini"],
        sign_in_for: None,
    },
    ImageProviderEntry {
        id: "google",
        label: "Google Gemini",
        api: ImageApi::Gemini,
        base_url: Some("https://generativelanguage.googleapis.com/v1beta"),
        key_id: "google",
        models: &["gemini-nano-banana-2.1", "gemini-3.1-flash-lite-image"],
        sign_in_for: None,
    },
    ImageProviderEntry {
        id: "doubao",
        label: "Doubao (Volcengine)",
        api: ImageApi::Seedream,
        base_url: Some("https://ark.cn-beijing.volces.com/api/v3"),
        key_id: "doubao",
        models: &[
            "doubao-seedream-5-0-pro-260628",
            "doubao-seedream-5-0-flash-260915",
        ],
        sign_in_for: None,
    },
    ImageProviderEntry {
        id: "qwen",
        label: "Alibaba Qwen",
        api: ImageApi::DashScope,
        // The same region as the chat provider's endpoint, which a key
        // belongs to.
        base_url: Some("https://dashscope.aliyuncs.com/api/v1"),
        key_id: "qwen",
        models: &["qwen-image-3.0-pro", "qwen-image-3.0"],
        sign_in_for: None,
    },
    ImageProviderEntry {
        id: "zhipu",
        label: "Zhipu GLM",
        api: ImageApi::Zhipu,
        base_url: Some("https://open.bigmodel.cn/api/paas/v4"),
        key_id: "zhipu",
        models: &["glm-image", "cogview-4-250304", "cogview-3-flash"],
        sign_in_for: None,
    },
    ImageProviderEntry {
        id: "minimax",
        label: "MiniMax (China)",
        api: ImageApi::MiniMax,
        base_url: Some("https://api.minimaxi.com/v1"),
        key_id: "minimax",
        models: &["image-01"],
        sign_in_for: None,
    },
    ImageProviderEntry {
        id: "minimax-intl",
        label: "MiniMax (Global)",
        api: ImageApi::MiniMax,
        base_url: Some("https://api.minimax.io/v1"),
        key_id: "minimax-intl",
        models: &["image-01"],
        sign_in_for: None,
    },
    ImageProviderEntry {
        id: "siliconflow",
        label: "SiliconFlow",
        api: ImageApi::SiliconFlow,
        base_url: Some("https://api.siliconflow.cn/v1"),
        key_id: "siliconflow",
        models: &["Qwen/Qwen-Image", "Kwai-Kolors/Kolors"],
        sign_in_for: None,
    },
    ImageProviderEntry {
        id: "custom",
        label: "OpenAI-compatible endpoint",
        api: ImageApi::Compatible,
        base_url: None,
        // Not the chat custom endpoint's: that one is a different server
        // more often than not.
        key_id: "__image_model_custom",
        models: &[],
        sign_in_for: None,
    },
];

/// The image model setting that follows the chat provider (the default).
pub const FOLLOW_CHAT: &str = "chat";

/// The image service that goes with a chat provider: OpenAI's through the
/// ChatGPT sign-in while there is one (as chat prefers it, route.rs), else
/// the provider's own pictures with the same key; None for a chat provider
/// that makes none, and so no generate_image.
pub fn following_chat(chat_provider: &str, chatgpt_signed_in: bool) -> Option<&'static str> {
    if chatgpt_signed_in {
        if let Some(entry) = IMAGE_PROVIDERS
            .iter()
            .find(|e| e.sign_in_for == Some(chat_provider))
        {
            return Some(entry.id);
        }
    }
    IMAGE_PROVIDERS
        .iter()
        .find(|e| e.key_id == chat_provider && e.id == chat_provider)
        .map(|e| e.id)
}

pub fn find(id: &str) -> Option<&'static ImageProviderEntry> {
    IMAGE_PROVIDERS.iter().find(|e| e.id == id)
}

/// The image model setting as a request carries it. Mirrors `ImageModel`
/// in src/ai/image-models.ts.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImageModel {
    pub provider: String,
    #[serde(default)]
    pub model: String,
    /// The compatible endpoint's address.
    #[serde(default)]
    pub base_url: String,
    /// At most this many pictures per send (Settings › Textus AI ›
    /// Pictures per request); `PER_SEND` when unset.
    #[serde(default)]
    pub limit: Option<usize>,
}

/// At most this many pictures per send by default, a retry of a refused one
/// included: each costs money, and a reply that wants more is asked to say
/// so. The setting may raise it to `MAX_PER_SEND`.
pub(crate) const PER_SEND: usize = 2;

pub(crate) const MAX_PER_SEND: usize = 8;

/// The per-send limit a setting asks for, kept within 1..=MAX_PER_SEND.
pub(crate) fn per_send(limit: Option<usize>) -> usize {
    limit.unwrap_or(PER_SEND).clamp(1, MAX_PER_SEND)
}
