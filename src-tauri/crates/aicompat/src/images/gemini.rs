//! Gemini's image models ("Nano Banana") through generateContent, asked for
//! an image part. A block shows up in the reply, not as an HTTP error: the
//! prompt's `promptFeedback.blockReason`, or the candidate's `finishReason`.

use super::{base64, join, malformed, Aspect, ImageError, Reply, Request};
use serde_json::{json, Value};

pub(super) fn request(base_url: &str, model: &str, prompt: &str, aspect: Aspect) -> Request {
    Request {
        url: join(base_url, &format!("models/{model}:generateContent")),
        body: json!({
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseModalities": ["TEXT", "IMAGE"],
                // 1K: every image model makes it, the Lite model nothing else.
                "imageConfig": {"aspectRatio": aspect.ratio(), "imageSize": "1K"},
            },
        }),
    }
}

/// The finish reasons that mean the picture was held back for its content.
const BLOCKED: &[&str] = &[
    "SAFETY",
    "PROHIBITED_CONTENT",
    "BLOCKLIST",
    "IMAGE_SAFETY",
    "IMAGE_PROHIBITED_CONTENT",
    "IMAGE_RECITATION",
    "RECITATION",
    "SPII",
];

pub(super) fn reply(reply: &Value) -> Result<Reply, ImageError> {
    if let Some(reason) = reply
        .pointer("/promptFeedback/blockReason")
        .and_then(Value::as_str)
    {
        let message = reply
            .pointer("/promptFeedback/blockReasonMessage")
            .and_then(Value::as_str);
        return Err(ImageError::Refused(message.unwrap_or(reason).to_string()));
    }
    let candidate = reply
        .pointer("/candidates/0")
        .ok_or_else(|| malformed("it holds no picture"))?;
    let parts = candidate
        .pointer("/content/parts")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    // The REST reply writes camelCase; snake_case is accepted too.
    let inline = parts
        .iter()
        .filter_map(|p| p.get("inlineData").or_else(|| p.get("inline_data")))
        .find(|d| {
            d.get("mimeType")
                .or_else(|| d.get("mime_type"))
                .and_then(Value::as_str)
                .is_some_and(|m| m.starts_with("image/"))
        });
    if let Some(data) = inline.and_then(|d| d.get("data")).and_then(Value::as_str) {
        return base64(data).map(Reply::Bytes);
    }
    let finish = candidate
        .get("finishReason")
        .and_then(Value::as_str)
        .unwrap_or("");
    let said = candidate
        .get("finishMessage")
        .and_then(Value::as_str)
        .map(str::to_string)
        // The model answered in words instead of a picture.
        .or_else(|| {
            let text: Vec<&str> = parts
                .iter()
                .filter_map(|p| p.get("text").and_then(Value::as_str))
                .collect();
            (!text.is_empty()).then(|| text.join(" ").trim().to_string())
        });
    if BLOCKED.contains(&finish) {
        return Err(ImageError::Refused(
            said.unwrap_or_else(|| finish.to_string()),
        ));
    }
    Err(ImageError::Failed(match said {
        Some(said) => format!("The model sent no picture: {said}"),
        None => format!("The model sent no picture ({finish})."),
    }))
}

/// An HTTP error is never a content block on this API.
pub(super) fn refusal(_body: &Value) -> Option<String> {
    None
}
