//! Zhipu's image models (GLM-Image and CogView) on OpenAI's path. GLM-Image
//! wants sides in multiples of 32 from 1024 and only `quality: "hd"`.

use super::{join, malformed, Aspect, ImageError, Reply, Request};
use serde_json::{json, Value};

fn size(model: &str, aspect: Aspect) -> &'static str {
    if model.starts_with("glm-image") {
        match aspect {
            Aspect::Square => "1280x1280",
            Aspect::Landscape => "1472x1088",
            Aspect::Portrait => "1088x1472",
            Aspect::Wide => "1728x960",
            Aspect::Tall => "960x1728",
        }
    } else {
        match aspect {
            Aspect::Square => "1024x1024",
            Aspect::Landscape => "1152x864",
            Aspect::Portrait => "864x1152",
            Aspect::Wide => "1344x768",
            Aspect::Tall => "768x1344",
        }
    }
}

pub(super) fn request(base_url: &str, model: &str, prompt: &str, aspect: Aspect) -> Request {
    let mut body = json!({
        "model": model,
        "prompt": prompt,
        "size": size(model, aspect),
    });
    if model.starts_with("glm-image") {
        body["quality"] = json!("hd");
    }
    Request {
        url: join(base_url, "images/generations"),
        body,
    }
}

pub(super) fn reply(reply: &Value) -> Result<Reply, ImageError> {
    reply
        .pointer("/data/0/url")
        .and_then(Value::as_str)
        .map(|url| Reply::Url(url.to_string()))
        .ok_or_else(|| malformed("it holds no picture"))
}

/// Zhipu writes its codes as strings ("1301"), now and then as numbers.
fn code(body: &Value) -> String {
    match body.pointer("/error/code") {
        Some(Value::String(code)) => code.clone(),
        Some(Value::Number(code)) => code.to_string(),
        _ => String::new(),
    }
}

/// 1301: the content check turned the request down.
pub(super) fn refusal(body: &Value) -> Option<String> {
    (code(body) == "1301")
        .then(|| super::error_message(body).unwrap_or_else(|| "content check".to_string()))
}

/// 1113: the account is in arrears; 1302 and 1305: over the rate, or the
/// model is overloaded.
pub(super) fn quota(body: &Value) -> bool {
    matches!(code(body).as_str(), "1113" | "1302" | "1305")
}
