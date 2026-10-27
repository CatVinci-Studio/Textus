//! SiliconFlow: OpenAI's path, but `image_size` instead of `size` and the
//! picture as a link under `images` that expires within the hour. Kolors
//! makes only square and upright sizes, so a wide request gets its square.

use super::{join, Aspect, ImageError, Reply, Request};
use serde_json::{json, Value};

fn size(model: &str, aspect: Aspect) -> &'static str {
    if model.contains("Kolors") {
        match aspect {
            Aspect::Portrait => "768x1024",
            Aspect::Tall => "720x1280",
            _ => "1024x1024",
        }
    } else {
        // Qwen-Image's sizes, which the FLUX and Z-Image models take too.
        match aspect {
            Aspect::Square => "1328x1328",
            Aspect::Landscape => "1472x1140",
            Aspect::Portrait => "1140x1472",
            Aspect::Wide => "1664x928",
            Aspect::Tall => "928x1664",
        }
    }
}

pub(super) fn request(base_url: &str, model: &str, prompt: &str, aspect: Aspect) -> Request {
    Request {
        url: join(base_url, "images/generations"),
        body: json!({
            "model": model,
            "prompt": prompt,
            "image_size": size(model, aspect),
        }),
    }
}

pub(super) fn reply(reply: &Value) -> Result<Reply, ImageError> {
    super::openai::reply(reply)
}

/// SiliconFlow documents no code for a content block; its message says so
/// in words.
pub(super) fn refusal(body: &Value) -> Option<String> {
    let message = super::error_message(body)?;
    let lower = message.to_lowercase();
    [
        "sensitive",
        "inappropriate",
        "moderation",
        "敏感",
        "违规",
        "不合规",
    ]
    .iter()
    .any(|word| lower.contains(word))
    .then_some(message)
}
