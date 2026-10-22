//! MiniMax's image-01, on its own path. It takes the aspect itself and
//! sends the picture back as base64. A failure often comes as HTTP 200
//! with a nonzero `base_resp.status_code`, so the reply is read for one.

use super::{join, malformed, Aspect, ImageError, Reply, Request};
use serde_json::{json, Value};

pub(super) fn request(base_url: &str, model: &str, prompt: &str, aspect: Aspect) -> Request {
    Request {
        url: join(base_url, "image_generation"),
        body: json!({
            "model": model,
            "prompt": prompt,
            "aspect_ratio": aspect.ratio(),
            "response_format": "base64",
            "n": 1,
        }),
    }
}

pub(super) fn reply(reply: &Value) -> Result<Reply, ImageError> {
    if let Some(error) = failure(reply) {
        return Err(error);
    }
    let encoded = reply
        .pointer("/data/image_base64/0")
        .and_then(Value::as_str)
        .ok_or_else(|| malformed("it holds no picture"))?;
    Ok(Reply::Bytes(super::base64(encoded)?))
}

fn status(body: &Value) -> (i64, String) {
    let code = body
        .pointer("/base_resp/status_code")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let message = body
        .pointer("/base_resp/status_msg")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    (code, message)
}

/// The failure a `base_resp` names, as one of the three kinds; None when
/// it says success.
fn failure(body: &Value) -> Option<ImageError> {
    let (code, message) = status(body);
    match code {
        0 => None,
        _ if refused(code) => Some(ImageError::Refused(message)),
        _ if over_quota(code) => Some(ImageError::Quota(message)),
        _ => Some(ImageError::Failed(format!(
            "Image request failed ({code}): {message}"
        ))),
    }
}

/// 1026 and 1027: the description, or the picture made, failed the
/// content check.
fn refused(code: i64) -> bool {
    matches!(code, 1026 | 1027)
}

/// 1002: over the rate; 1008: out of balance.
fn over_quota(code: i64) -> bool {
    matches!(code, 1002 | 1008)
}

pub(super) fn refusal(body: &Value) -> Option<String> {
    let (code, message) = status(body);
    refused(code).then_some(message)
}

pub(super) fn quota(body: &Value) -> bool {
    over_quota(status(body).0)
}
