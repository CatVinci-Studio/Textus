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
use crate::ai::tools::{self, Access, ProposalLedger, Run, Tool, EDITING_MODES};
use aicompat::agent::{AgentTurn, ToolCall, ToolOutput, ToolSpec};
use aicompat::images::{self as gen, Aspect, GeneratedImage, ImageApi, ImageTarget};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::AppHandle;

mod inline;

pub use inline::InlinePictures;

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
    /// At most this many pictures per send (Settings › Textus AI ›
    /// Pictures per request); `PER_SEND` when unset.
    #[serde(default)]
    pub limit: Option<usize>,
}

/// At most this many pictures per send by default, a retry of a refused one
/// included: each costs money, and a reply that wants more is asked to say
/// so. The setting may raise it to `MAX_PER_SEND`.
const PER_SEND: usize = 2;
const MAX_PER_SEND: usize = 8;

/// The per-send limit a setting asks for, kept within 1..=MAX_PER_SEND.
fn per_send(limit: Option<usize>) -> usize {
    limit.unwrap_or(PER_SEND).clamp(1, MAX_PER_SEND)
}

/// generate_image's actions: the insertions, and `replace` - a picture
/// already in the document, for one that redoes it. A picture for new text
/// is written into that text instead (inline).
const IMAGE_ACTIONS: [&str; 5] = [
    "insert_after",
    "insert_before",
    "insert_at_cursor",
    "append",
    "replace",
];

/// The src a picture being made has in a proposal's Markdown, until it is
/// saved. Mirrors `generatedImageSrc` in src/ai/revision/generated-images.ts.
fn placeholder_src(id: &str) -> String {
    format!("textus-generated:{id}")
}

/// What a picture may stand next to besides the document: the text of
/// proposals not decided yet - this request's own (ProposalLedger), and an
/// earlier request's the user hasn't accepted or rejected - where the
/// frontend puts the picture into that proposal.
pub struct ProposedText<'a> {
    pub this_request: &'a std::sync::Mutex<ProposalLedger>,
    pub undecided: &'a [String],
}

impl ProposedText<'_> {
    /// Whether `anchor` is quoted from exactly one of them.
    fn quotes(&self, anchor: &str) -> bool {
        let ledger = self.this_request.lock().unwrap_or_else(|e| e.into_inner());
        let found: Vec<&String> = ledger
            .texts()
            .iter()
            .chain(self.undecided)
            .filter(|text| text.contains(anchor))
            .collect();
        found.len() == 1 && found[0].matches(anchor).count() == 1
    }
}

/// The new text of each propose_edit in `history` the user hasn't decided
/// on yet, as its result's status note says (src/ai/revision/
/// proposal-status.ts).
pub fn undecided_texts(history: &[AgentTurn]) -> Vec<String> {
    const UNDECIDED: &str = "has NOT yet accepted or rejected this proposed edit";
    history
        .iter()
        .filter_map(|turn| match turn {
            AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
                ..
            } if name == "propose_edit" => {
                let open = history.iter().any(|t| {
                    matches!(t, AgentTurn::ToolResult { call_id: id, output, .. }
                        if id == call_id && output.contains(UNDECIDED))
                });
                let args: Value = serde_json::from_str(arguments).ok()?;
                let text = args.get("text")?.as_str()?;
                (open && !text.is_empty()).then(|| text.to_string())
            }
            _ => None,
        })
        .collect()
}

/// The pictures earlier requests made that the user hasn't accepted or
/// rejected yet, by id: a rewrite of the text by one may carry it
/// (ProposalLedger's known pictures).
pub fn undecided_pictures(history: &[AgentTurn]) -> Vec<String> {
    const UNDECIDED: &str = "has NOT yet accepted or rejected this proposed edit";
    history
        .iter()
        .filter_map(|turn| match turn {
            AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
                ..
            } if name == GENERATE_IMAGE_TOOL_NAME => {
                let open = history.iter().any(|t| {
                    matches!(t, AgentTurn::ToolResult { call_id: id, output, .. }
                        if id == call_id && output.contains(UNDECIDED))
                });
                let args: Value = serde_json::from_str(arguments).ok()?;
                let id = args.get("image")?.get("id")?.as_str()?;
                open.then(|| id.to_string())
            }
            _ => None,
        })
        .collect()
}

/// Whether `anchor` is the whole Markdown of one picture, `![alt](src)` -
/// the only thing a picture may replace.
fn is_picture_markdown(anchor: &str) -> bool {
    let Some(rest) = anchor.trim().strip_prefix("![") else {
        return false;
    };
    let Some((alt, after)) = rest.split_once("](") else {
        return false;
    };
    !alt.contains(']') && after.ends_with(')') && !after[..after.len() - 1].contains(')')
}

/// Where a picture is asked for: the image model resolved to an address and
/// a key - or, for the ChatGPT sign-in, to the app that holds its
/// credential. Owned, so a picture can be made after the call that asked
/// for it has returned.
#[derive(Clone)]
struct ImageJob {
    /// For the ChatGPT sign-in, whose credential is fetched (and refreshed)
    /// per picture.
    app: Option<AppHandle>,
    api: ImageApi,
    base_url: String,
    api_key: String,
    model: String,
}

/// One request's image model, and how many pictures it has asked for, of
/// how many it may.
pub struct ImageRun {
    job: ImageJob,
    made: AtomicUsize,
    limit: usize,
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
                job: ImageJob {
                    app: Some(app.clone()),
                    api: entry.api,
                    base_url: String::new(),
                    api_key: String::new(),
                    model: entry.models[0].to_string(),
                },
                made: AtomicUsize::new(0),
                limit: per_send(choice.limit),
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
            job: ImageJob {
                app: None,
                api: entry.api,
                base_url,
                api_key,
                model,
            },
            made: AtomicUsize::new(0),
            limit: per_send(choice.limit),
        })
    }
}

impl ImageRun {
    /// A request's image model that makes no picture: each one asked for
    /// fails in the background (nothing listens at its address), and
    /// generate_image answers the model as it would for a real one - for
    /// the live picture cases (live_eval::images), which spend nothing on
    /// pictures.
    #[cfg(test)]
    pub(crate) fn offline(limit: usize) -> Self {
        Self {
            job: ImageJob {
                app: None,
                api: ImageApi::OpenAi,
                base_url: "https://127.0.0.1:1".into(),
                api_key: "sk".into(),
                model: "gpt-image-2".into(),
            },
            made: AtomicUsize::new(0),
            limit,
        }
    }

    /// A request's image model on a real service (`provider` from the
    /// catalog, its cheapest model) with this key: the live picture cases
    /// that pay for their pictures.
    #[cfg(test)]
    pub(crate) fn live(provider: &str, api_key: String, limit: usize) -> Option<Self> {
        let entry = find(provider)?;
        Some(Self {
            job: ImageJob {
                app: None,
                api: entry.api,
                base_url: entry.base_url?.to_string(),
                api_key,
                model: entry.models.last()?.to_string(),
            },
            made: AtomicUsize::new(0),
            limit,
        })
    }
}

impl ImageJob {
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
}

impl ImageRun {
    /// One generate_image call's arguments, with what came of it recorded
    /// in them: `image` - the picture's id and its size as asked, while it
    /// is made in the background - or `not_generated` (why not). What the
    /// model may have put under those names is dropped.
    ///
    /// The call returns at once and the reply goes on - its text, and more
    /// pictures - while the picture is made: one took the whole reply's
    /// half a minute to a minute before. The document shows the picture's
    /// frame in place until it comes (ai_generated_image waits for it), or
    /// why it didn't.
    async fn run_call(
        &self,
        arguments: &str,
        document: &str,
        proposed: &ProposedText<'_>,
        announce: impl FnOnce(),
    ) -> String {
        let Ok(Value::Object(mut args)) = serde_json::from_str::<Value>(arguments) else {
            return arguments.to_string();
        };
        args.remove("image");
        args.remove("not_generated");
        let outcome = match self.check(&Value::Object(args.clone()), document, proposed) {
            Err(why) => Err(why),
            Ok((prompt, aspect)) => {
                announce();
                Ok(self.start(prompt, aspect))
            }
        };
        match outcome {
            Ok((id, (width, height))) => {
                args.insert(
                    "image".into(),
                    json!({"id": id, "width": width, "height": height, "pending": true}),
                );
            }
            Err(why) => {
                args.insert("not_generated".into(), json!(why));
            }
        }
        Value::Object(args).to_string()
    }

    /// Starts making one picture in the background; its id, and the size
    /// it is asked for (the frame's shape until it comes).
    fn start(&self, prompt: String, aspect: Aspect) -> (String, (u32, u32)) {
        let id = begin();
        let job = self.job.clone();
        let made = id.clone();
        tauri::async_runtime::spawn(async move {
            let slot = match job.generate(&prompt, aspect).await {
                Ok(image) => Slot::Ready(image),
                Err(why) => Slot::Failed(why.to_string()),
            };
            finish(&made, slot);
        });
        (id, nominal_size(aspect))
    }

    /// Starts making a picture written into new text (inline), if this
    /// send has pictures left; its id and size, or why not.
    fn begin_picture(
        &self,
        prompt: String,
        aspect: Aspect,
    ) -> Result<(String, (u32, u32)), String> {
        self.spend()?;
        Ok(self.start(prompt, aspect))
    }

    /// One of this send's pictures, or why there are none left.
    fn spend(&self) -> Result<(), String> {
        let limit = self.limit;
        if self.made.fetch_add(1, Ordering::SeqCst) >= limit {
            return Err(format!("This request has already made {limit} pictures, the most one request may (the user's setting). Ask the user whether they want more."));
        }
        Ok(())
    }

    /// The call is fit to spend a picture on: a description, a place that
    /// exists in the document, and pictures left in this send.
    fn check(
        &self,
        args: &Value,
        document: &str,
        proposed: &ProposedText<'_>,
    ) -> Result<(String, Aspect), String> {
        let text = |key: &str| args.get(key).and_then(Value::as_str).unwrap_or("").trim();
        let prompt = text("prompt");
        if prompt.is_empty() {
            return Err("`prompt` is empty - describe the picture.".into());
        }
        let action = text("action");
        if !IMAGE_ACTIONS.contains(&action) {
            return Err(format!(
                "Unknown action `{action}`. Use one of: {}.",
                IMAGE_ACTIONS.join(", ")
            ));
        }
        if action == "replace" {
            let anchor = text("anchor");
            if !is_picture_markdown(anchor) {
                return Err("`replace` takes `anchor` as a picture's whole Markdown, `![alt](src)`, copied from the document - a picture replaces only a picture; put one next to text with insert_after.".into());
            }
            tools::check_anchor(document, args, anchor)?;
        }
        if matches!(action, "insert_after" | "insert_before") {
            let anchor = text("anchor");
            if anchor.is_empty() {
                return Err(format!(
                    "`{action}` requires `anchor` - the text the picture goes next to."
                ));
            }
            // Next to text proposed and not decided yet, the picture joins
            // that proposal (useEditorProposals).
            if !proposed.quotes(anchor) {
                tools::check_anchor(document, args, anchor)?;
            }
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
        self.spend()?;
        Ok((prompt.to_string(), aspect))
    }
}

impl ImageRun {
    /// generate_image for this request, offered in Write and Revise.
    pub fn tool<'a>(
        &'a self,
        document: &'a str,
        proposed: ProposedText<'a>,
        channel: &'a Channel<StreamEvent>,
    ) -> Tool<'a> {
        let proposed = std::sync::Arc::new(proposed);
        Tool {
            spec: spec(self.limit),
            access: Access::ProposesInItsCall,
            modes: EDITING_MODES,
            run: Run::Async(Box::new(move |call| {
                let proposed = proposed.clone();
                Box::pin(async move { self.execute(call, document, &proposed, channel).await })
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
        proposed: &ProposedText<'_>,
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
        let arguments = self
            .run_call(&call.arguments, document, proposed, announce)
            .await;
        ToolOutput {
            text: outcome(&arguments),
            call_arguments: Some(arguments),
            ..ToolOutput::default()
        }
    }
}

/// What the model is told about generate_image, with this request's limit.
fn description(limit: usize) -> String {
    let (scheme, aspects) = (inline::PICTURE_SCHEME, Aspect::ALL.join(" "));
    format!("Make a picture with the user's image model and propose it for the document: the user sees it in place, and it is saved only if they accept. Use it when the user asks for a picture, an illustration, a figure or a cover - not for charts or diagrams you can write as Markdown or Mermaid. Write `prompt` as a full visual description in English: subject, setting, composition, style, light and colours, and no text in the picture unless asked.\n\nHow many: each picture costs the user money, and this request may make at most {limit}. When the user says how many, make that many (up to {limit}); when they don't, make one, or - for a longer piece they asked to illustrate - one for each part that gains from a picture.\n\nNew text with pictures (an empty document, a new section, a piece to write and illustrate): don't call generate_image - write each picture into the text you propose with propose_edit, as a line of its own between paragraphs where it goes: `![alt]({scheme}ASPECT description)` - alt a short caption in the document's language, ASPECT one of {aspects}, then the full English description, as for `prompt`. Each picture starts being made the moment its line is written, while you go on writing; the user sees its frame there and accepts the text and its pictures together. These lines count toward the limit, and each describes a different picture.\n\nA picture for text already in the document - or for text you proposed that the user hasn't accepted or rejected yet - goes insert_after the paragraph it illustrates, `anchor` quoted from it. Between paragraphs, never inside a list, a table, a quote or a heading's line, and not two pictures in a row.\n\nRedoing a picture: to change or replace one already in the document, use `replace` with `anchor` its whole Markdown, `![alt](src)`, copied from the document, and describe the new picture in full in `prompt` (what to keep, what to change). The user decides whether the old file goes once they accept.\n\nIf the service refuses the description, tell the user what it said in plain words; don't change the description and try again on your own.")
}

/// What the model is told about generate_image.
fn spec(limit: usize) -> ToolSpec {
    ToolSpec {
        name: GENERATE_IMAGE_TOOL_NAME.into(),
        description: description(limit).into(),
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
                    "enum": IMAGE_ACTIONS,
                    "description": "Where it goes: insert_after a paragraph (the usual place for an illustration of existing text), insert_before one, insert_at_cursor, append - or replace a picture already in the document."
                },
                "anchor": {
                    "type": "string",
                    "description": "For insert_after and insert_before: the paragraph the picture goes next to, quoted verbatim - the whole of it if it is short, else its last sentence. For replace: the picture's whole Markdown, `![alt](src)`."
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
        // Its Markdown, for a later rewrite of the text it stands by to
        // carry it before the user decides on it.
        let alt = args["alt"].as_str().unwrap_or("").replace(['[', ']'], "");
        let markdown = format!(
            "![{}]({})",
            alt.split_whitespace().collect::<Vec<_>>().join(" "),
            placeholder_src(image["id"].as_str().unwrap_or(""))
        );
        let carry = format!(" Until the user decides on it, its Markdown is {markdown}: if you rewrite the paragraph it stands by, put that line in your new text where the picture goes.");
        if image["pending"].as_bool() == Some(true) {
            return format!("Image proposed and being made ({size} pixels) while you go on, and appears in place by itself with Accept and Reject once it is ready (or, if the service turns it down, the user sees why there). It is saved only if they accept. Carry on with the rest of the request now - don't wait for it. In your reply, say in a sentence what it shows and where it goes; don't repeat the prompt.{carry}");
        }
        return format!("Image proposed - the user now sees the picture ({size} pixels) in the document with Accept and Reject; it is saved only if they accept. In your reply, say in a sentence what it shows and where it goes; don't repeat the prompt.{carry}");
    }
    let why = args
        .get("not_generated")
        .and_then(Value::as_str)
        .unwrap_or("there is no image model set up for this request");
    format!("Not generated: {why} Tell the user in plain words; don't change the description and call again unless they ask.")
}

/// A picture asked for: still being made, made, or not made and why.
enum Slot {
    Making,
    Ready(GeneratedImage),
    Failed(String),
}

impl Slot {
    fn bytes(&self) -> usize {
        match self {
            Slot::Ready(image) => image.bytes.len(),
            _ => 0,
        }
    }
}

/// The pictures waiting for a decision, newest last. Bounded: a long
/// session of undecided pictures must not hold hundreds of megabytes; the
/// oldest go first (and its proposal can then no longer be accepted - the
/// frontend says so).
static PENDING: Mutex<Vec<(String, Slot)>> = Mutex::new(Vec::new());
const PENDING_COUNT: usize = 16;
const PENDING_BYTES: usize = 128 * 1024 * 1024;

/// How long the frontend waits for a picture still being made: the
/// slowest services take about two minutes, and give up at three.
const WAIT_FOR_PICTURE: std::time::Duration = std::time::Duration::from_secs(200);

fn pending() -> std::sync::MutexGuard<'static, Vec<(String, Slot)>> {
    PENDING.lock().unwrap_or_else(|e| e.into_inner())
}

/// A new picture's id, its slot marked as being made.
fn begin() -> String {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    // Short, and unlike the one before: the model copies it into its text,
    // and two long ids differing in their last digits were copied wrong
    // (one picture drawn in two places). Six letters and digits from a
    // mix of the time and a counter.
    let mut x = (nanos as u64) ^ ((NEXT.fetch_add(1, Ordering::Relaxed) as u64) << 40);
    x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^= x >> 31;
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let id: String = (0..6)
        .map(|i| DIGITS[((x >> (i * 6)) % 36) as usize] as char)
        .collect();
    let mut pending = pending();
    pending.push((id.clone(), Slot::Making));
    while pending.len() > PENDING_COUNT
        || pending.iter().map(|(_, s)| s.bytes()).sum::<usize>() > PENDING_BYTES
    {
        pending.remove(0);
    }
    id
}

/// What came of a picture being made. Nothing, if it was let go meanwhile
/// (its proposal rejected while it was painting).
fn finish(id: &str, slot: Slot) {
    let mut pending = pending();
    if let Some((_, waiting)) = pending.iter_mut().find(|(i, _)| i == id) {
        *waiting = slot;
    }
    while pending.iter().map(|(_, s)| s.bytes()).sum::<usize>() > PENDING_BYTES {
        pending.remove(0);
    }
}

/// The size a picture is asked for at `aspect`, as GPT image makes it: the
/// frame's shape while it is made (the service rounds to its own).
fn nominal_size(aspect: Aspect) -> (u32, u32) {
    let size = gen::gpt_image_size(aspect);
    let (w, h) = size.split_once('x').unwrap_or(("1024", "1024"));
    (w.parse().unwrap_or(1024), h.parse().unwrap_or(1024))
}

/// A pending picture as the frontend takes it. Mirrors `GeneratedImageData`
/// in src/platform/ipc.ts.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImageData {
    mime: &'static str,
    ext: &'static str,
    data_base64: String,
    width: u32,
    height: u32,
}

#[cfg(test)]
impl GeneratedImageData {
    pub(crate) fn data_base64_len(&self) -> usize {
        self.data_base64.len()
    }
}

/// What a picture's slot holds now: the picture, why it wasn't made, or
/// None while it is being made.
fn look(id: &str) -> Option<Result<GeneratedImageData, String>> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let pending = pending();
    let Some((_, slot)) = pending.iter().find(|(i, _)| i == id) else {
        return Some(Err(
            "This picture is no longer available - ask for it again.".to_string(),
        ));
    };
    match slot {
        Slot::Making => None,
        Slot::Failed(why) => Some(Err(why.clone())),
        Slot::Ready(image) => Some(Ok(GeneratedImageData {
            mime: image.mime,
            ext: image.ext,
            data_base64: STANDARD.encode(&image.bytes),
            width: image.width,
            height: image.height,
        })),
    }
}

/// A picture, once it is made: the frame in the document waits on this.
/// Its error is why it wasn't made, in the service's words.
#[tauri::command]
pub async fn ai_generated_image(id: String) -> Result<GeneratedImageData, String> {
    let deadline = std::time::Instant::now() + WAIT_FOR_PICTURE;
    loop {
        if let Some(found) = look(&id) {
            return found;
        }
        if std::time::Instant::now() >= deadline {
            return Err("The image service didn't send the picture in time.".to_string());
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
}

/// Lets a picture go: its proposal was rejected, or it was saved. One
/// still being made is let go too; what it makes is thrown away.
#[tauri::command]
pub fn ai_discard_generated_image(id: String) {
    pending().retain(|(i, _)| *i != id);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run() -> ImageRun {
        ImageRun {
            job: ImageJob {
                app: None,
                api: ImageApi::OpenAi,
                // Nothing listens here: a picture asked for fails to
                // connect.
                base_url: "https://127.0.0.1:1".into(),
                api_key: "sk".into(),
                model: "gpt-image-2".into(),
            },
            made: AtomicUsize::new(0),
            limit: PER_SEND,
        }
    }

    fn picture(id: &str) -> Result<GeneratedImageData, String> {
        tauri::async_runtime::block_on(ai_generated_image(id.to_string()))
    }

    fn call(run: &ImageRun, args: Value, document: &str) -> (Value, bool) {
        call_with(run, args, document, &[], &[])
    }

    /// A call with proposals not decided yet: this request's, and earlier
    /// ones'.
    fn call_with(
        run: &ImageRun,
        args: Value,
        document: &str,
        this_request: &[&str],
        undecided: &[String],
    ) -> (Value, bool) {
        let this_request = std::sync::Mutex::new(ProposalLedger::with_texts(this_request));
        let proposed = ProposedText {
            this_request: &this_request,
            undecided,
        };
        let mut announced = false;
        let out = tauri::async_runtime::block_on(run.run_call(
            &args.to_string(),
            document,
            &proposed,
            || announced = true,
        ));
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
        // `replace` takes a picture, not text.
        assert!(args["not_generated"]
            .as_str()
            .unwrap()
            .contains("a picture replaces only a picture"));
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
    fn a_picture_for_new_text_is_written_into_it_not_asked_for() {
        let run = run();
        let (args, announced) = call(
            &run,
            json!({"prompt": "boats", "alt": "Boats", "action": "in_text"}),
            "",
        );
        assert!(!announced);
        assert!(generate_image_text(&args).contains("Unknown action `in_text`"));
        assert!(description(2).contains("![alt](textus-picture:ASPECT description)"));
    }

    #[test]
    fn a_picture_may_stand_next_to_text_proposed_and_not_decided_yet() {
        let run = run();
        let new = "The tide went out before dawn.\n\nThe boats came back at dusk.";
        let at = |anchor: &str| json!({"prompt": "boats", "alt": "Boats", "action": "insert_after", "anchor": anchor});
        // This request's own proposal, which isn't in the empty document.
        let (args, _) = call_with(&run, at("The boats came back at dusk."), "", &[new], &[]);
        assert!(args.get("image").is_some(), "{args}");
        // An earlier request's, still undecided.
        let (args, _) = call_with(
            &run,
            at("The tide went out before dawn."),
            DOC,
            &[],
            &[new.to_string()],
        );
        assert!(args.get("image").is_some(), "{args}");
        // Text found nowhere is still refused, and spends nothing.
        let (args, _) = call_with(&run, at("Nowhere at all."), DOC, &[new], &[]);
        assert!(args["not_generated"]
            .as_str()
            .unwrap()
            .contains("No exact match"));
        assert_eq!(run.made.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_picture_not_decided_yet_is_known_with_its_markdown() {
        let call = |id: &str, image: &str| {
            AgentTurn::ToolCall {
            call_id: id.into(),
            name: GENERATE_IMAGE_TOOL_NAME.into(),
            arguments: json!({"prompt": "p", "alt": "Boats", "action": "insert_after", "anchor": "A.", "image": {"id": image, "width": 1, "height": 1}}).to_string(),
            reasoning: None,
        }
        };
        let result = |id: &str, note: &str| AgentTurn::ToolResult {
            call_id: id.into(),
            output: format!("Image proposed. {note}"),
            images: Vec::new(),
        };
        let history = vec![
            call("g1", "open1"),
            result(
                "g1",
                "Status: the user has NOT yet accepted or rejected this proposed edit.",
            ),
            call("g2", "taken"),
            result("g2", "Status: the user accepted this proposed edit."),
        ];
        assert_eq!(undecided_pictures(&history), vec!["open1".to_string()]);
        let text = outcome(&json!({"alt": "Boats", "action": "insert_after", "image": {"id": "open1", "width": 1, "height": 1}}).to_string());
        assert!(text.contains("![Boats](textus-generated:open1)"), "{text}");
    }

    #[test]
    fn undecided_texts_are_read_off_the_status_notes() {
        let call = |id: &str, text: &str| AgentTurn::ToolCall {
            call_id: id.into(),
            name: "propose_edit".into(),
            arguments: json!({"action": "append", "text": text}).to_string(),
            reasoning: None,
        };
        let result = |id: &str, note: &str| AgentTurn::ToolResult {
            call_id: id.into(),
            output: format!("Edit proposed.\n\n[{note}]"),
            images: Vec::new(),
        };
        let history = vec![
            call("a", "Kept."),
            result("a", "Status: the user accepted this proposed edit - the document text in this request includes it."),
            call("b", "Open."),
            result("b", "Status: the user has NOT yet accepted or rejected this proposed edit. It is still shown to them as a preview."),
        ];
        assert_eq!(undecided_texts(&history), vec!["Open.".to_string()]);
    }

    #[test]
    fn a_picture_is_made_while_the_reply_goes_on() {
        let run = run();
        let (args, announced) = call(
            &run,
            json!({"prompt": "boats at dusk", "alt": "Boats", "action": "insert_after", "anchor": "The boats came in at dusk.", "aspect": "16:9"}),
            DOC,
        );
        assert!(announced);
        // Returned at once, with the frame's shape, before any answer.
        let image = &args["image"];
        assert_eq!(image["pending"], true);
        assert_eq!(
            (image["width"].as_u64(), image["height"].as_u64()),
            (Some(1536), Some(1024))
        );
        let text = generate_image_text(&args);
        assert!(text.starts_with("Image proposed and being made"), "{text}");
        assert!(text.contains("don't wait for it"));
        // Nothing answers here: the frame learns why.
        let why = picture(image["id"].as_str().unwrap()).unwrap_err();
        assert!(why.starts_with("Couldn't reach the image service"), "{why}");
    }

    #[test]
    fn the_frame_waits_for_the_picture_and_gets_it() {
        let id = begin();
        assert!(look(&id).is_none());
        let waiting = std::thread::spawn({
            let id = id.clone();
            move || picture(&id)
        });
        std::thread::sleep(std::time::Duration::from_millis(400));
        finish(
            &id,
            Slot::Ready(GeneratedImage {
                bytes: vec![1, 2, 3],
                mime: "image/png",
                ext: "png",
                width: 4,
                height: 3,
            }),
        );
        let data = waiting.join().unwrap().unwrap();
        assert_eq!((data.data_base64.as_str(), data.width), ("AQID", 4));
    }

    #[test]
    fn a_picture_let_go_while_painting_stays_gone() {
        let id = begin();
        ai_discard_generated_image(id.clone());
        finish(&id, Slot::Failed("late".into()));
        assert!(picture(&id).unwrap_err().contains("no longer available"));
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
        let id = begin();
        finish(
            &id,
            Slot::Ready(GeneratedImage {
                bytes: vec![1, 2, 3],
                mime: "image/png",
                ext: "png",
                width: 4,
                height: 3,
            }),
        );
        let data = picture(&id).unwrap();
        assert_eq!(
            (data.mime, data.data_base64.as_str()),
            ("image/png", "AQID")
        );
        let text = generate_image_text(&json!({"image": {"id": id, "width": 4, "height": 3}}));
        assert!(text.starts_with("Image proposed"), "{text}");
        assert!(text.contains("4 x 3 pixels"));
        ai_discard_generated_image(id.clone());
        assert!(picture(&id).is_err());
    }

    #[test]
    fn the_tool_offers_insertions_replacing_a_picture_and_the_five_aspects() {
        let spec = spec(PER_SEND);
        assert_eq!(
            spec.parameters["properties"]["action"]["enum"],
            json!(IMAGE_ACTIONS)
        );
        assert_eq!(
            spec.parameters["properties"]["aspect"]["enum"],
            json!(Aspect::ALL)
        );
    }

    #[test]
    fn a_picture_in_the_document_can_be_redone() {
        let doc = format!("{DOC}\n\n![Boats at dusk](assets/boats.png)");
        let (args, announced) = call(
            &run(),
            json!({"prompt": "the boats at dawn instead", "alt": "Boats at dawn", "action": "replace", "anchor": "![Boats at dusk](assets/boats.png)"}),
            &doc,
        );
        assert!(announced);
        assert_eq!(args["image"]["pending"], true);
        // Only one that is there, and only a whole picture.
        let (args, _) = call(
            &run(),
            json!({"prompt": "x", "action": "replace", "anchor": "![Nets](assets/nets.png)"}),
            &doc,
        );
        assert!(args["not_generated"]
            .as_str()
            .unwrap()
            .contains("No exact match"));
        assert!(is_picture_markdown("![a](b.png)"));
        assert!(is_picture_markdown("![](<my file.png>)"));
        assert!(!is_picture_markdown("![a](b.png) and text"));
        assert!(!is_picture_markdown("The boats came in at dusk."));
    }

    #[test]
    fn the_limit_is_the_setting_within_bounds_and_the_model_is_told_it() {
        assert_eq!(per_send(None), PER_SEND);
        assert_eq!(per_send(Some(4)), 4);
        assert_eq!(per_send(Some(0)), 1);
        assert_eq!(per_send(Some(50)), MAX_PER_SEND);
        let mut run = run();
        run.limit = 3;
        let args = json!({"prompt": "nets", "alt": "Nets", "action": "append"});
        for _ in 0..3 {
            assert!(call(&run, args.clone(), DOC).1);
        }
        let (fourth, _) = call(&run, args, DOC);
        assert!(fourth["not_generated"]
            .as_str()
            .unwrap()
            .contains("already made 3 pictures"));
        assert!(description(3).contains("at most 3"));
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
