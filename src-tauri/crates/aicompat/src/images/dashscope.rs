//! Alibaba Cloud Model Studio (DashScope) with Qwen-Image, through the
//! synchronous multimodal-generation route. The picture comes back as a
//! link, good for a day.

use super::{join, malformed, Aspect, ImageError, Reply, Request};
use serde_json::{json, Value};

/// Qwen-Image's own sizes, about 1.8 megapixels each; DashScope writes
/// them with `*`.
fn size(aspect: Aspect) -> &'static str {
    match aspect {
        Aspect::Square => "1328*1328",
        Aspect::Landscape => "1472*1104",
        Aspect::Portrait => "1104*1472",
        Aspect::Wide => "1664*928",
        Aspect::Tall => "928*1664",
    }
}

pub(super) fn request(base_url: &str, model: &str, prompt: &str, aspect: Aspect) -> Request {
    Request {
        url: join(base_url, "services/aigc/multimodal-generation/generation"),
        body: json!({
            "model": model,
            "input": {"messages": [{"role": "user", "content": [{"text": prompt}]}]},
            "parameters": {
                "size": size(aspect),
                "n": 1,
                // The agent already wrote a full description; rewritten,
                // the picture drifts from what it was asked to show.
                "prompt_extend": false,
            },
        }),
    }
}

pub(super) fn reply(reply: &Value) -> Result<Reply, ImageError> {
    let content = reply
        .pointer("/output/choices/0/message/content")
        .and_then(Value::as_array)
        .ok_or_else(|| malformed("it holds no picture"))?;
    content
        .iter()
        .find_map(|part| part.get("image").and_then(Value::as_str))
        .map(|url| Reply::Url(url.to_string()))
        .ok_or_else(|| malformed("it holds no picture"))
}

fn code(body: &Value) -> &str {
    body.get("code").and_then(Value::as_str).unwrap_or("")
}

/// `DataInspectionFailed` (the input or the output failed the content
/// check), and the copyright and role blocks.
pub(super) fn refusal(body: &Value) -> Option<String> {
    let code = code(body);
    let flagged = code.eq_ignore_ascii_case("DataInspectionFailed")
        || code.eq_ignore_ascii_case("data_inspection_failed")
        || code == "IPInfringementSuspect"
        || code == "CustomRoleBlocked";
    flagged.then(|| super::error_message(body).unwrap_or_else(|| code.to_string()))
}

/// `Arrearage` (the account owes money) and the throttling codes.
pub(super) fn quota(body: &Value) -> bool {
    let code = code(body);
    code == "Arrearage" || code.starts_with("Throttling")
}
