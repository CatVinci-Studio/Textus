//! OpenAI's Images API, and the servers that copy it. GPT image models
//! always answer in base64 and refuse `response_format`; other models
//! behind a compatible server (DALL-E-style proxies, local servers) may
//! answer with a link unless asked for base64, so they are asked.

use super::{base64, join, malformed, Aspect, ImageApi, ImageTarget, Reply, Request};
use serde_json::{json, Value};

/// The three sizes every GPT image model makes; the other aspects take the
/// nearest of them.
fn size(aspect: Aspect) -> &'static str {
    match aspect {
        Aspect::Square => "1024x1024",
        Aspect::Landscape | Aspect::Wide => "1536x1024",
        Aspect::Portrait | Aspect::Tall => "1024x1536",
    }
}

pub(super) fn request(target: &ImageTarget, prompt: &str, aspect: Aspect) -> Request {
    let gpt_image =
        target.model.starts_with("gpt-image") || target.model.starts_with("chatgpt-image");
    let mut body = json!({
        "model": target.model,
        "prompt": prompt,
        "size": size(aspect),
        "n": 1,
    });
    if target.api == ImageApi::OpenAi {
        // Medium is a fifth of high's price and plenty for a page; JPEG is
        // a fraction of the PNG's size, and every export reads it.
        body["quality"] = json!("medium");
        body["output_format"] = json!("jpeg");
    } else if !gpt_image {
        body["response_format"] = json!("b64_json");
    }
    Request {
        url: join(target.base_url, "images/generations"),
        body,
    }
}

pub(super) fn reply(reply: &Value) -> Result<Reply, super::ImageError> {
    // `images` is SiliconFlow's shape, which some compatible servers use.
    let first = reply
        .pointer("/data/0")
        .or_else(|| reply.pointer("/images/0"))
        .ok_or_else(|| malformed("it holds no picture"))?;
    if let Some(data) = first.get("b64_json").and_then(Value::as_str) {
        return base64(data).map(Reply::Bytes);
    }
    first
        .get("url")
        .and_then(Value::as_str)
        .map(|url| Reply::Url(url.to_string()))
        .ok_or_else(|| malformed("it holds neither picture data nor a link"))
}

/// GPT image's `moderation_blocked`, or DALL-E's `content_policy_violation`
/// that compatible servers often pass on.
pub(super) fn refusal(body: &Value) -> Option<String> {
    let error = body.get("error")?;
    let code = error.get("code").and_then(Value::as_str).unwrap_or("");
    let message = error.get("message").and_then(Value::as_str).unwrap_or("");
    let flagged = code == "moderation_blocked" || code == "content_policy_violation";
    flagged.then(|| {
        if message.is_empty() {
            "it was blocked by the safety system".to_string()
        } else {
            message.to_string()
        }
    })
}
