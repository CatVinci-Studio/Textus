//! Text-to-image generation: the wire format each service speaks and the
//! picture back as checked bytes. Every service is asked for one picture at
//! about a megapixel, downloaded at once because the services' links expire.

mod dashscope;
mod fetch;
mod gemini;
mod minimax;
mod openai;
mod seedream;
mod siliconflow;
mod sniff;
mod zhipu;

use crate::agent::ImageAttachment;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

/// The shapes a picture can take. The agent's tool offers these and
/// nothing finer: each service rounds them to the nearest size it makes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
pub enum Aspect {
    #[default]
    #[serde(rename = "1:1")]
    Square,
    #[serde(rename = "4:3")]
    Landscape,
    #[serde(rename = "3:4")]
    Portrait,
    #[serde(rename = "16:9")]
    Wide,
    #[serde(rename = "9:16")]
    Tall,
}

impl Aspect {
    pub const ALL: [&'static str; 5] = ["1:1", "4:3", "3:4", "16:9", "9:16"];

    pub fn parse(value: &str) -> Option<Self> {
        serde_json::from_value(Value::String(value.to_string())).ok()
    }

    pub fn ratio(self) -> &'static str {
        Self::ALL[self as usize]
    }
}

/// How a service is asked for a picture.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "kebab-case")]
pub enum ImageApi {
    /// OpenAI's Images API with a GPT image model.
    OpenAi,
    /// Any other server with an OpenAI-style `/images/generations`.
    Compatible,
    /// Gemini's generateContent with an image model.
    Gemini,
    /// Volcengine Ark's Seedream models.
    Seedream,
    /// Alibaba Cloud Model Studio (DashScope), Qwen-Image.
    DashScope,
    /// Zhipu's GLM-Image and CogView.
    Zhipu,
    /// SiliconFlow, OpenAI's path with its own fields.
    SiliconFlow,
    /// MiniMax's image-01.
    MiniMax,
    /// The ChatGPT sign-in: the image_generation tool on ChatGPT's backend,
    /// not an Images API, so never through [`generate`].
    ChatGpt,
}

impl ImageApi {
    /// Whether a picture being redone is sent along with its description,
    /// for the service to change rather than draw anew.
    pub fn takes_reference(self) -> bool {
        matches!(self, Self::Gemini | Self::Seedream | Self::ChatGpt)
    }
}

/// Where one request goes. `api_key` may be empty only for a local server.
pub struct ImageTarget<'a> {
    pub api: ImageApi,
    pub base_url: &'a str,
    pub api_key: &'a str,
    pub model: &'a str,
}

/// A picture, checked to be a PNG, JPEG or WebP of the size it says.
#[derive(Clone, Debug)]
pub struct GeneratedImage {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
    pub ext: &'static str,
    pub width: u32,
    pub height: u32,
}

/// Why no picture came back, in the three kinds the user can act on
/// differently. Each carries the service's own words where it gave any.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ImageError {
    /// The service's content checks turned the description, or the picture
    /// it made, down. Not retried: the user decides what to ask for instead.
    Refused(String),
    /// Out of balance, quota or rate.
    Quota(String),
    /// Anything else: the key, the model, the network, a malformed reply.
    Failed(String),
}

impl std::fmt::Display for ImageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Refused(why) => write!(f, "The service refused this description: {why}"),
            Self::Quota(why) => write!(f, "The service's quota or balance ran out: {why}"),
            Self::Failed(why) => f.write_str(why),
        }
    }
}

/// One request as a service wants it.
struct Request {
    url: String,
    body: Value,
}

/// What a service's answer holds.
#[derive(Debug, PartialEq)]
enum Reply {
    Bytes(Vec<u8>),
    Url(String),
}

/// How long a picture may take: the slowest models take about two minutes.
const GENERATION_TIMEOUT: Duration = Duration::from_secs(180);

/// A local server may speak plain HTTP - nothing leaves the machine - and
/// every other address must be HTTPS: the key travels with the request.
fn check_endpoint(base_url: &str) -> Result<reqwest::Url, ImageError> {
    let url = reqwest::Url::parse(base_url.trim()).map_err(|e| {
        ImageError::Failed(format!("The image endpoint isn't a valid address: {e}"))
    })?;
    let local = matches!(url.host(), Some(url::Host::Domain("localhost")))
        || matches!(url.host(), Some(url::Host::Ipv4(ip)) if ip.is_loopback())
        || matches!(url.host(), Some(url::Host::Ipv6(ip)) if ip.is_loopback());
    match url.scheme() {
        "https" => Ok(url),
        "http" if local => Ok(url),
        _ => Err(ImageError::Failed(
            "The image endpoint must be an https:// address (or a server on this computer).".into(),
        )),
    }
}

fn join(base_url: &str, path: &str) -> String {
    format!("{}/{}", base_url.trim().trim_end_matches('/'), path)
}

fn request(target: &ImageTarget, prompt: &str, aspect: Aspect) -> Request {
    let base = target.base_url;
    match target.api {
        ImageApi::OpenAi | ImageApi::Compatible | ImageApi::ChatGpt => {
            openai::request(target, prompt, aspect)
        }
        ImageApi::Gemini => gemini::request(base, target.model, prompt, aspect),
        ImageApi::Seedream => seedream::request(base, target.model, prompt, aspect),
        ImageApi::DashScope => dashscope::request(base, target.model, prompt, aspect),
        ImageApi::Zhipu => zhipu::request(base, target.model, prompt, aspect),
        ImageApi::SiliconFlow => siliconflow::request(base, target.model, prompt, aspect),
        ImageApi::MiniMax => minimax::request(base, target.model, prompt, aspect),
    }
}

fn read_reply(api: ImageApi, reply: &Value) -> Result<Reply, ImageError> {
    match api {
        ImageApi::OpenAi | ImageApi::Compatible | ImageApi::ChatGpt => openai::reply(reply),
        ImageApi::Gemini => gemini::reply(reply),
        ImageApi::Seedream => seedream::reply(reply),
        ImageApi::DashScope => dashscope::reply(reply),
        ImageApi::Zhipu => zhipu::reply(reply),
        ImageApi::SiliconFlow => siliconflow::reply(reply),
        ImageApi::MiniMax => minimax::reply(reply),
    }
}

/// A failed request, by its status and body, as one of the three kinds.
fn read_failure(api: ImageApi, status: reqwest::StatusCode, body: &str) -> ImageError {
    let parsed: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let refused = match api {
        ImageApi::OpenAi | ImageApi::Compatible | ImageApi::ChatGpt => openai::refusal(&parsed),
        ImageApi::Gemini => gemini::refusal(&parsed),
        ImageApi::Seedream => seedream::refusal(&parsed),
        ImageApi::DashScope => dashscope::refusal(&parsed),
        ImageApi::Zhipu => zhipu::refusal(&parsed),
        ImageApi::SiliconFlow => siliconflow::refusal(&parsed),
        ImageApi::MiniMax => minimax::refusal(&parsed),
    };
    let message = error_message(&parsed).unwrap_or_else(|| short(body));
    if let Some(reason) = refused {
        return ImageError::Refused(reason);
    }
    let quota = match api {
        ImageApi::Seedream => seedream::quota(&parsed),
        ImageApi::DashScope => dashscope::quota(&parsed),
        ImageApi::Zhipu => zhipu::quota(&parsed),
        ImageApi::MiniMax => minimax::quota(&parsed),
        _ => false,
    };
    if quota || status == reqwest::StatusCode::PAYMENT_REQUIRED || status.as_u16() == 429 {
        return ImageError::Quota(message);
    }
    ImageError::Failed(format!("Image request failed ({status}): {message}"))
}

/// The human-readable part of an error body, in the shapes these services
/// use: `{"error": {"message"}}`, `{"message"}` or `{"error": "..."}`.
fn error_message(body: &Value) -> Option<String> {
    [
        body.pointer("/error/message"),
        body.get("message"),
        body.get("error"),
    ]
    .into_iter()
    .flatten()
    .find_map(|v| v.as_str())
    .filter(|s| !s.trim().is_empty())
    .map(|s| s.trim().to_string())
}

/// A body that isn't JSON (a proxy's HTML page), cut to something a
/// sentence can carry.
fn short(body: &str) -> String {
    let body = body.trim();
    match body.char_indices().nth(300) {
        Some((at, _)) => format!("{}…", &body[..at]),
        None => body.to_string(),
    }
}

fn base64(encoded: &str) -> Result<Vec<u8>, ImageError> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD
        .decode(encoded.trim())
        .map_err(|_| malformed("its picture data isn't valid base64"))
}

fn malformed(what: &str) -> ImageError {
    ImageError::Failed(format!(
        "The image service sent a reply Textus can't read: {what}."
    ))
}

/// `reference` (the picture being redone) put into a request for a service
/// that takes one ([`ImageApi::takes_reference`]); left out otherwise.
fn with_reference(api: ImageApi, body: &mut Value, reference: Option<&ImageAttachment>) {
    let Some(reference) = reference.filter(|_| api.takes_reference()) else {
        return;
    };
    match api {
        // Before the description, as Gemini's image editing reads them.
        ImageApi::Gemini => {
            if let Some(parts) = body
                .pointer_mut("/contents/0/parts")
                .and_then(Value::as_array_mut)
            {
                parts.insert(
                    0,
                    json!({"inlineData": {"mimeType": reference.mime, "data": reference.data_base64}}),
                );
            }
        }
        ImageApi::Seedream => body["image"] = json!(reference.data_url()),
        _ => {}
    }
}

/// Generates one picture - from `reference` where one is given and the
/// service takes it, changed as `prompt` says.
pub async fn generate(
    target: &ImageTarget<'_>,
    prompt: &str,
    aspect: Aspect,
    reference: Option<&ImageAttachment>,
) -> Result<GeneratedImage, ImageError> {
    if target.api == ImageApi::ChatGpt {
        return Err(ImageError::Failed(
            "A picture through the ChatGPT sign-in is asked for with openai_codex::generate_image."
                .into(),
        ));
    }
    check_endpoint(target.base_url)?;
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err(ImageError::Failed(
            "There is no description to draw.".into(),
        ));
    }
    let Request { url, mut body } = request(target, prompt, aspect);
    with_reference(target.api, &mut body, reference);
    let mut req = crate::http::long_client(GENERATION_TIMEOUT)
        .post(url)
        .json(&body);
    if !target.api_key.is_empty() {
        req = match target.api {
            ImageApi::Gemini => req.header("x-goog-api-key", target.api_key),
            _ => req.bearer_auth(target.api_key),
        };
    }
    let res = req.send().await.map_err(|e| {
        ImageError::Failed(if e.is_timeout() {
            "The image service didn't answer within three minutes.".to_string()
        } else {
            format!("Couldn't reach the image service: {e}")
        })
    })?;
    let status = res.status();
    let text = res.text().await.map_err(|e| {
        ImageError::Failed(format!("Reading the image service's reply failed: {e}"))
    })?;
    if !status.is_success() {
        return Err(read_failure(target.api, status, &text));
    }
    let reply: Value = serde_json::from_str(&text).map_err(|_| malformed("it isn't JSON"))?;
    let bytes = match read_reply(target.api, &reply)? {
        Reply::Bytes(bytes) => bytes,
        Reply::Url(url) => fetch::download(&url).await?,
    };
    checked_image(bytes)
}

/// Bytes a service sent, checked to be a picture: its type and size read
/// from the file itself.
pub fn checked_image(bytes: Vec<u8>) -> Result<GeneratedImage, ImageError> {
    let found = sniff::sniff(&bytes)
        .ok_or_else(|| malformed("the file it sent isn't a PNG, JPEG or WebP picture"))?;
    Ok(GeneratedImage {
        bytes,
        mime: found.mime,
        ext: found.ext,
        width: found.width,
        height: found.height,
    })
}

/// The size a GPT image model is asked for at `aspect`.
pub fn gpt_image_size(aspect: Aspect) -> &'static str {
    openai::size(aspect)
}

/// Base64 picture data, decoded.
pub fn decode_base64(encoded: &str) -> Result<Vec<u8>, ImageError> {
    base64(encoded)
}

#[cfg(test)]
mod tests;
