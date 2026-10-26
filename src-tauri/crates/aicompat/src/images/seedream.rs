//! Volcengine Ark's Seedream models (Doubao): OpenAI's path and fields,
//! with Ark's sizes and error codes. The sizes here are the smallest Seedream
//! makes at each aspect.

use super::{base64, join, malformed, Aspect, ImageError, Reply, Request};
use serde_json::{json, Value};

fn size(aspect: Aspect) -> &'static str {
    match aspect {
        Aspect::Square => "1024x1024",
        Aspect::Landscape => "1152x864",
        Aspect::Portrait => "864x1152",
        Aspect::Wide => "1280x720",
        Aspect::Tall => "720x1280",
    }
}

pub(super) fn request(base_url: &str, model: &str, prompt: &str, aspect: Aspect) -> Request {
    Request {
        url: join(base_url, "images/generations"),
        body: json!({
            "model": model,
            "prompt": prompt,
            "size": size(aspect),
            // In the reply itself: no second request, no link to expire.
            "response_format": "b64_json",
        }),
    }
}

pub(super) fn reply(reply: &Value) -> Result<Reply, ImageError> {
    let first = reply.pointer("/data/0");
    // A picture that failed in a batch carries its own error.
    let failed = first
        .and_then(|d| d.get("error"))
        .or_else(|| reply.get("error"));
    if let Some(error) = failed {
        return Err(match refusal(&json!({ "error": error })) {
            Some(reason) => ImageError::Refused(reason),
            None => ImageError::Failed(
                super::error_message(&json!({ "error": error }))
                    .unwrap_or_else(|| "The service made no picture.".into()),
            ),
        });
    }
    let first = first.ok_or_else(|| malformed("it holds no picture"))?;
    if let Some(data) = first.get("b64_json").and_then(Value::as_str) {
        return base64(data).map(Reply::Bytes);
    }
    first
        .get("url")
        .and_then(Value::as_str)
        .map(|url| Reply::Url(url.to_string()))
        .ok_or_else(|| malformed("it holds neither picture data nor a link"))
}

fn code(body: &Value) -> &str {
    body.pointer("/error/code")
        .and_then(Value::as_str)
        .unwrap_or("")
}

/// `InputTextSensitiveContentDetected`, `OutputImageSensitiveContentDetected`
/// and their `.Violence`-style variants, the `...RiskDetection` and
/// copyright `...PolicyViolation` codes.
pub(super) fn refusal(body: &Value) -> Option<String> {
    let code = code(body);
    let flagged = code.contains("SensitiveContentDetected")
        || code.contains("RiskDetection")
        || code.contains("PolicyViolation");
    flagged.then(|| super::error_message(body).unwrap_or_else(|| code.to_string()))
}

/// Out of balance (`AccountOverdueError`), or over a quota or rate.
pub(super) fn quota(body: &Value) -> bool {
    let code = code(body);
    code.contains("Overdue") || code.contains("QuotaExceeded") || code.contains("RateLimit")
}
