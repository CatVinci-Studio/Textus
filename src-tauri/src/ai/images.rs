//! Pictures from Textus AI (#194): the image model chosen in Settings ›
//! Textus AI (none by default - a picture costs money, and most chat models
//! can't make one), the generate_image tool the agent gets while one is
//! chosen, and the pictures waiting for the user's decision.
//!
//! A picture is a proposal like any other edit. The tool runs the request
//! ([`ImageRun::execute`]) and keeps the picture here, in memory; the
//! frontend shows it in place with Accept and Reject, and only Accept
//! saves it - into the image folder, under the naming rules, or up to the
//! image host, as Settings › Images says for a pasted picture - and writes
//! the Markdown image. Reject, or closing the app, leaves nothing behind.
//! The protocol of each service is aicompat::images. Ideas from #221 by
//! Zhuohang Jiang: the per-send cap, the checked download, refusals told
//! apart from failures.

use crate::ai::agent::StreamEvent;
use crate::ai::tools::{self, Access, Run, Tool, EDITING_MODES};
use aicompat::agent::{ToolCall, ToolOutput, ToolSpec};
use aicompat::images::{self as gen, Aspect, GeneratedImage, ImageApi, ImageTarget};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::AppHandle;

pub const GENERATE_IMAGE_TOOL_NAME: &str = "generate_image";

/// One service Settings › Textus AI › Image model offers. Mirrored by
/// `ImageProviderEntry` in src/ai/image-models.ts.
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct ImageProviderEntry {
    pub id: &'static str,
    /// A brand name; "custom" and "doubao" are localized by the frontend.
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
    },
    ImageProviderEntry {
        id: "google",
        label: "Google Gemini",
        api: ImageApi::Gemini,
        base_url: Some("https://generativelanguage.googleapis.com/v1beta"),
        key_id: "google",
        models: &["gemini-nano-banana-2.1", "gemini-3.1-flash-lite-image"],
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
    },
    ImageProviderEntry {
        id: "zhipu",
        label: "Zhipu GLM",
        api: ImageApi::Zhipu,
        base_url: Some("https://open.bigmodel.cn/api/paas/v4"),
        key_id: "zhipu",
        models: &["glm-image", "cogview-4-250304", "cogview-3-flash"],
    },
    ImageProviderEntry {
        id: "siliconflow",
        label: "SiliconFlow",
        api: ImageApi::SiliconFlow,
        base_url: Some("https://api.siliconflow.cn/v1"),
        key_id: "siliconflow",
        models: &["Qwen/Qwen-Image", "Kwai-Kolors/Kolors"],
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
    },
];

/// The image model setting that follows the chat provider (the default).
pub const FOLLOW_CHAT: &str = "chat";

/// The image service that goes with a chat provider: OpenAI's through the
/// ChatGPT sign-in while there is one (as chat prefers it, route.rs), else
/// the provider's own pictures with the same key; None for a chat provider
/// that makes none, and so no generate_image.
pub fn following_chat(chat_provider: &str, chatgpt_signed_in: bool) -> Option<&'static str> {
    if chat_provider == "openai" && chatgpt_signed_in {
        return Some("openai-chatgpt");
    }
    IMAGE_PROVIDERS
        .iter()
        .find(|e| e.key_id == chat_provider && e.id == chat_provider)
        .map(|e| e.id)
}

pub fn find(id: &str) -> Option<&'static ImageProviderEntry> {
    IMAGE_PROVIDERS.iter().find(|e| e.id == id)
}

#[tauri::command]
pub fn list_image_providers() -> Vec<ImageProviderEntry> {
    IMAGE_PROVIDERS.to_vec()
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
}

/// At most this many pictures per send, a retry of a refused one included:
/// each costs money, and a reply that wants more is asked to say so.
const PER_SEND: usize = 2;

/// One request's image model, resolved to an address and a key - or, for
/// the ChatGPT sign-in, to the app that holds its credential - and how many
/// pictures it has made so far.
pub struct ImageRun {
    /// For the ChatGPT sign-in, whose credential is fetched (and refreshed)
    /// per picture.
    app: Option<AppHandle>,
    api: ImageApi,
    base_url: String,
    api_key: String,
    model: String,
    made: AtomicUsize,
}

impl ImageRun {
    /// None - and no generate_image tool - without an image model, or
    /// without the key it needs. (Review mode, which changes nothing, never
    /// offers it: ToolRegistry::add.)
    pub fn resolve(
        app: &AppHandle,
        choice: Option<&ImageModel>,
        chat_provider: &str,
    ) -> Option<Self> {
        let choice = choice?;
        let entry = if choice.provider == FOLLOW_CHAT {
            find(following_chat(
                chat_provider,
                crate::auth::openai_codex::signed_in(app),
            )?)?
        } else {
            find(&choice.provider)?
        };
        if entry.api == ImageApi::ChatGpt {
            // Signed in with ChatGPT, or no generate_image at all.
            return crate::auth::openai_codex::signed_in(app).then(|| Self {
                app: Some(app.clone()),
                api: entry.api,
                base_url: String::new(),
                api_key: String::new(),
                model: entry.models[0].to_string(),
                made: AtomicUsize::new(0),
            });
        }
        let model = Some(choice.model.trim())
            // One of this service's own (a model kept from another service, as
            // following the chat provider can leave, is not), or any typed for
            // the compatible endpoint.
            .filter(|m| !m.is_empty() && (entry.models.is_empty() || entry.models.contains(m)))
            .or_else(|| entry.models.first().copied())?
            .to_string();
        let base_url = entry
            .base_url
            .map(str::to_string)
            .unwrap_or_else(|| choice.base_url.trim().to_string());
        if base_url.is_empty() {
            return None;
        }
        let api_key = crate::auth::keys::load_provider_key(app, entry.key_id)
            .ok()
            .flatten()
            .unwrap_or_default();
        // A compatible endpoint on this computer may need no key.
        if api_key.is_empty() && entry.api != ImageApi::Compatible {
            return None;
        }
        Some(Self {
            app: None,
            api: entry.api,
            base_url,
            api_key,
            model,
            made: AtomicUsize::new(0),
        })
    }

    /// One picture from the chosen service.
    async fn generate(
        &self,
        prompt: &str,
        aspect: Aspect,
    ) -> Result<GeneratedImage, gen::ImageError> {
        let Some(app) = self.app.as_ref().filter(|_| self.api == ImageApi::ChatGpt) else {
            return gen::generate(&self.target(), prompt, aspect).await;
        };
        let (access_token, account_id) = crate::auth::openai_codex::get_valid_credential(app)
            .await
            .map_err(|e| {
                gen::ImageError::Failed(format!(
                    "The ChatGPT sign-in isn't usable - sign in again in Settings › Textus AI: {e}"
                ))
            })?;
        aicompat::providers::openai_codex::generate_image(
            &access_token,
            &account_id,
            crate::app_identity::ORIGINATOR,
            prompt,
            aspect,
        )
        .await
    }

    fn target(&self) -> ImageTarget<'_> {
        ImageTarget {
            api: self.api,
            base_url: &self.base_url,
            api_key: &self.api_key,
            model: &self.model,
        }
    }

    /// One generate_image call's arguments, with what came of it recorded
    /// in them: `image` (the picture's id and size) or `not_generated` (why
    /// not). What the model may have put under those names is dropped.
    async fn run_call(&self, arguments: &str, document: &str, announce: impl FnOnce()) -> String {
        let Ok(Value::Object(mut args)) = serde_json::from_str::<Value>(arguments) else {
            return arguments.to_string();
        };
        args.remove("image");
        args.remove("not_generated");
        let outcome = match self.check(&Value::Object(args.clone()), document) {
            Err(why) => Err(why),
            Ok((prompt, aspect)) => {
                announce();
                self.generate(&prompt, aspect)
                    .await
                    .map_err(|e| e.to_string())
            }
        };
        match outcome {
            Ok(image) => {
                let (width, height) = (image.width, image.height);
                let id = keep(image);
                args.insert(
                    "image".into(),
                    json!({"id": id, "width": width, "height": height}),
                );
            }
            Err(why) => {
                args.insert("not_generated".into(), json!(why));
            }
        }
        Value::Object(args).to_string()
    }

    /// The call is fit to spend a picture on: a description, a place that
    /// exists in the document, and pictures left in this send.
    fn check(&self, args: &Value, document: &str) -> Result<(String, Aspect), String> {
        let text = |key: &str| args.get(key).and_then(Value::as_str).unwrap_or("").trim();
        let prompt = text("prompt");
        if prompt.is_empty() {
            return Err("`prompt` is empty - describe the picture.".into());
        }
        let action = text("action");
        if !tools::INSERT_ACTIONS.contains(&action) {
            return Err(format!(
                "Unknown action `{action}`. Use one of: {}.",
                tools::INSERT_ACTIONS.join(", ")
            ));
        }
        if matches!(action, "insert_after" | "insert_before") {
            let anchor = text("anchor");
            if anchor.is_empty() {
                return Err(format!(
                    "`{action}` requires `anchor` - the text the picture goes next to."
                ));
            }
            tools::check_anchor(document, args, anchor)?;
        }
        let aspect = match text("aspect") {
            "" => Aspect::default(),
            ratio => Aspect::parse(ratio).ok_or_else(|| {
                format!(
                    "Unknown aspect `{ratio}`. Use one of: {}.",
                    Aspect::ALL.join(", ")
                )
            })?,
        };
        if self.made.fetch_add(1, Ordering::SeqCst) >= PER_SEND {
            return Err(format!("This request has already made {PER_SEND} pictures, the most one request may. Ask the user whether they want more."));
        }
        Ok((prompt.to_string(), aspect))
    }
}

impl ImageRun {
    /// generate_image for this request, offered in Write and Revise.
    pub fn tool<'a>(&'a self, document: &'a str, channel: &'a Channel<StreamEvent>) -> Tool<'a> {
        Tool {
            spec: spec(),
            access: Access::ProposesInItsCall,
            modes: EDITING_MODES,
            run: Run::Async(Box::new(move |call| {
                Box::pin(self.execute(call, document, channel))
            })),
        }
    }

    /// Runs one generate_image call: the picture is made (or why not is
    /// said) and recorded in the call's arguments, which is where the
    /// frontend shows the proposal from (ToolRun::Amending). Async like any
    /// tool, so the chat's Stop drops a picture being made.
    async fn execute(
        &self,
        call: ToolCall,
        document: &str,
        channel: &Channel<StreamEvent>,
    ) -> ToolOutput {
        // The provider may not have streamed the call's start; the
        // frontend says "Generating an image…" from this.
        let announce = || {
            let _ = channel.send(StreamEvent::ToolStart {
                call_id: call.call_id.clone(),
                name: call.name.clone(),
            });
        };
        let arguments = self.run_call(&call.arguments, document, announce).await;
        ToolOutput {
            text: outcome(&arguments),
            call_arguments: Some(arguments),
            ..ToolOutput::default()
        }
    }
}

const GENERATE_IMAGE_DESCRIPTION: &str = "Make a picture with the user's image model and propose it for the document, placed like an insertion: the user sees it in place with Accept and Reject, and it is saved only if they accept. Use it when the user asks for a picture, an illustration, a figure or a cover - not for charts or diagrams you can write as Markdown or Mermaid. Write `prompt` as a full visual description in English: subject, setting, composition, style, light and colours, and no text in the picture unless asked. Each picture costs the user money: make one per request unless they ask for more (at most 2). If the service refuses the description, tell the user what it said in plain words; don't change the description and try again on your own.";

/// What the model is told about generate_image.
fn spec() -> ToolSpec {
    ToolSpec {
        name: GENERATE_IMAGE_TOOL_NAME.into(),
        description: GENERATE_IMAGE_DESCRIPTION.into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "What the picture shows, in English, in detail."
                },
                "alt": {
                    "type": "string",
                    "description": "A short description of the picture for its alt text, in the document's language."
                },
                "aspect": {
                    "type": "string",
                    "enum": Aspect::ALL,
                    "description": "Width to height. Default 1:1."
                },
                "action": {
                    "type": "string",
                    "enum": tools::INSERT_ACTIONS,
                    "description": "Where it goes, as propose_edit's insertions: insert_after a paragraph (the usual place for an illustration), insert_before one, insert_at_cursor, or append."
                },
                "anchor": {
                    "type": "string",
                    "description": "For insert_after and insert_before: the paragraph or heading the picture goes next to, quoted verbatim - the whole of it if it is short, else its last sentence."
                },
                "context": {
                    "type": "string",
                    "description": "Only when `anchor` occurs more than once: a longer verbatim quote containing it that occurs once."
                }
            },
            "required": ["prompt", "alt", "action"],
        }),
    }
}

/// What the model is told came of its call - read off what
/// ImageRun::execute recorded in the arguments.
fn outcome(arguments: &str) -> String {
    let args: Value = serde_json::from_str(arguments).unwrap_or_default();
    if let Some(image) = args.get("image") {
        let size = format!(
            "{} x {}",
            image["width"].as_u64().unwrap_or(0),
            image["height"].as_u64().unwrap_or(0)
        );
        return format!("Image proposed - the user now sees the picture ({size} pixels) in the document with Accept and Reject; it is saved only if they accept. In your reply, say in a sentence what it shows and where it goes; don't repeat the prompt.");
    }
    let why = args
        .get("not_generated")
        .and_then(Value::as_str)
        .unwrap_or("there is no image model set up for this request");
    format!("Not generated: {why} Tell the user in plain words; don't change the description and call again unless they ask.")
}

/// The pictures waiting for a decision, newest last. Bounded: a long
/// session of undecided pictures must not hold hundreds of megabytes; the
/// oldest go first (and its proposal can then no longer be accepted - the
/// frontend says so).
static PENDING: Mutex<Vec<(String, GeneratedImage)>> = Mutex::new(Vec::new());
const PENDING_COUNT: usize = 16;
const PENDING_BYTES: usize = 128 * 1024 * 1024;

fn keep(image: GeneratedImage) -> String {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let id = format!("{nanos:x}{:x}", NEXT.fetch_add(1, Ordering::Relaxed));
    let mut pending = PENDING.lock().unwrap_or_else(|e| e.into_inner());
    pending.push((id.clone(), image));
    while pending.len() > PENDING_COUNT
        || pending.iter().map(|(_, i)| i.bytes.len()).sum::<usize>() > PENDING_BYTES
    {
        pending.remove(0);
    }
    id
}

/// A pending picture as the frontend takes it. Mirrors `GeneratedImageData`
/// in src/platform/ipc.ts.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImageData {
    mime: &'static str,
    ext: &'static str,
    data_base64: String,
}

#[tauri::command]
pub fn ai_generated_image(id: String) -> Result<GeneratedImageData, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let pending = PENDING.lock().unwrap_or_else(|e| e.into_inner());
    let (_, image) = pending
        .iter()
        .find(|(i, _)| *i == id)
        .ok_or_else(|| "This picture is no longer available - ask for it again.".to_string())?;
    Ok(GeneratedImageData {
        mime: image.mime,
        ext: image.ext,
        data_base64: STANDARD.encode(&image.bytes),
    })
}

/// Lets a picture go: its proposal was rejected, or it was saved.
#[tauri::command]
pub fn ai_discard_generated_image(id: String) {
    PENDING
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .retain(|(i, _)| *i != id);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run() -> ImageRun {
        ImageRun {
            app: None,
            api: ImageApi::OpenAi,
            // Nothing listens here: a call that got as far as the request
            // fails to connect, which these tests never let it.
            base_url: "https://127.0.0.1:1".into(),
            api_key: "sk".into(),
            model: "gpt-image-2".into(),
            made: AtomicUsize::new(0),
        }
    }

    fn call(run: &ImageRun, args: Value, document: &str) -> (Value, bool) {
        let mut announced = false;
        let out = tauri::async_runtime::block_on(
            run.run_call(&args.to_string(), document, || announced = true),
        );
        (serde_json::from_str(&out).unwrap(), announced)
    }

    const DOC: &str =
        "# Harbour\n\nThe boats came in at dusk.\n\nThe nets were mended by lamplight.";

    #[test]
    fn a_call_that_cant_be_placed_spends_nothing() {
        let run = run();
        let (args, announced) = call(
            &run,
            json!({"prompt": "boats", "alt": "Boats", "action": "insert_after", "anchor": "No such text."}),
            DOC,
        );
        assert!(!announced);
        assert!(args["not_generated"]
            .as_str()
            .unwrap()
            .contains("No exact match"));
        assert!(args.get("image").is_none());
        let (args, _) = call(
            &run,
            json!({"prompt": "boats", "action": "replace", "anchor": "The boats came in at dusk."}),
            DOC,
        );
        assert!(args["not_generated"]
            .as_str()
            .unwrap()
            .contains("Unknown action `replace`"));
        let (args, _) = call(&run, json!({"prompt": " ", "action": "append"}), DOC);
        assert!(args["not_generated"]
            .as_str()
            .unwrap()
            .contains("`prompt` is empty"));
        assert_eq!(run.made.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn what_the_model_wrote_under_image_is_never_taken_for_a_picture() {
        let (args, announced) = call(
            &run(),
            json!({"prompt": "", "action": "append", "image": {"id": "forged"}}),
            DOC,
        );
        assert!(!announced);
        assert!(args.get("image").is_none());
        assert!(generate_image_text(&args).starts_with("Not generated"));
    }

    #[test]
    fn a_failed_request_is_recorded_and_told_to_the_model() {
        let run = run();
        let (args, announced) = call(
            &run,
            json!({"prompt": "boats at dusk", "alt": "Boats", "action": "insert_after", "anchor": "The boats came in at dusk.", "aspect": "16:9"}),
            DOC,
        );
        assert!(announced);
        let text = generate_image_text(&args);
        assert!(
            text.starts_with("Not generated: Couldn't reach the image service"),
            "{text}"
        );
        assert!(text.contains("don't change the description"));
    }

    #[test]
    fn a_send_makes_at_most_two_pictures() {
        let run = run();
        let args = json!({"prompt": "nets", "alt": "Nets", "action": "append"});
        for _ in 0..PER_SEND {
            assert!(call(&run, args.clone(), DOC).1);
        }
        let (third, announced) = call(&run, args, DOC);
        assert!(!announced);
        assert!(third["not_generated"]
            .as_str()
            .unwrap()
            .contains("already made 2 pictures"));
    }

    #[test]
    fn a_kept_picture_is_proposed_and_can_be_let_go() {
        let id = keep(GeneratedImage {
            bytes: vec![1, 2, 3],
            mime: "image/png",
            ext: "png",
            width: 4,
            height: 3,
        });
        let data = ai_generated_image(id.clone()).unwrap();
        assert_eq!(
            (data.mime, data.data_base64.as_str()),
            ("image/png", "AQID")
        );
        let text = generate_image_text(&json!({"image": {"id": id, "width": 4, "height": 3}}));
        assert!(text.starts_with("Image proposed"), "{text}");
        assert!(text.contains("4 x 3 pixels"));
        ai_discard_generated_image(id.clone());
        assert!(ai_generated_image(id).is_err());
    }

    #[test]
    fn the_tool_offers_only_insertions_and_the_five_aspects() {
        let spec = spec();
        assert_eq!(
            spec.parameters["properties"]["action"]["enum"],
            json!(tools::INSERT_ACTIONS)
        );
        assert_eq!(
            spec.parameters["properties"]["aspect"]["enum"],
            json!(Aspect::ALL)
        );
    }

    #[test]
    fn the_image_model_follows_the_chat_provider() {
        // OpenAI: the sign-in's pictures while signed in, the key's else.
        assert_eq!(following_chat("openai", true), Some("openai-chatgpt"));
        assert_eq!(following_chat("openai", false), Some("openai"));
        // A provider with pictures of its own, on the same key.
        assert_eq!(following_chat("google", false), Some("google"));
        assert_eq!(following_chat("doubao", true), Some("doubao"));
        // One that makes none, and the compatible endpoint, which is a
        // different server from chat's: no pictures.
        assert_eq!(following_chat("anthropic", false), None);
        assert_eq!(following_chat("deepseek", false), None);
        assert_eq!(following_chat("custom", false), None);
    }

    #[test]
    fn every_built_in_image_provider_has_an_https_address_and_a_default_model() {
        for entry in IMAGE_PROVIDERS {
            if entry.id == "custom" {
                assert!(entry.base_url.is_none() && entry.models.is_empty());
                continue;
            }
            // The sign-in has no address or key, only its one model.
            if entry.api == ImageApi::ChatGpt {
                assert!(entry.base_url.is_none() && entry.key_id.is_empty());
                assert_eq!(entry.models.len(), 1);
                continue;
            }
            assert!(
                entry.base_url.unwrap().starts_with("https://"),
                "{}",
                entry.id
            );
            assert!(!entry.models.is_empty(), "{}", entry.id);
        }
        // A chat provider that makes pictures (the capability table says
        // which, and how) is offered with its own key.
        for chat in crate::ai::catalog::PROVIDER_CATALOG {
            let caps = aicompat::capabilities::provider(chat.id);
            match (caps.image, find(chat.id)) {
                (Some(api), Some(entry)) => {
                    assert_eq!(entry.api, api, "{}", chat.id);
                    assert_eq!(entry.key_id, chat.id);
                }
                (None, Some(entry)) => assert_eq!(entry.id, "custom"),
                (Some(_), None) => panic!("{} makes pictures but isn't offered", chat.id),
                (None, None) => {}
            }
        }
    }

    fn generate_image_text(args: &Value) -> String {
        outcome(&args.to_string())
    }
}
