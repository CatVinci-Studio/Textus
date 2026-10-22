//! Gemini's OpenAI-compatible layer, asked for its thoughts
//! (`include_thoughts`), sends them as the reply's text. Streamed, each
//! thought chunk is marked `extra_content.google.thought`; whole, the text
//! opens with them between `<think>` tags (Vertex AI, gemini-3.8-flash,
//! 2026-10-22). Split out here, they go where every other provider's
//! reasoning goes.

use serde_json::Value;

/// Whether a streamed delta's text is a thought.
pub(crate) fn is_thought(delta: &Value) -> bool {
    delta
        .pointer("/extra_content/google/thought")
        .and_then(Value::as_bool)
        == Some(true)
}

/// A whole reply's text as (thought, answer).
pub(crate) fn split_whole(text: &str) -> (String, String) {
    for (open, close) in [("<think>", "</think>"), ("<thought>", "</thought>")] {
        let Some(rest) = text.trim_start().strip_prefix(open) else {
            continue;
        };
        if let Some(end) = rest.find(close) {
            let answer = rest[end + close.len()..].trim_start();
            return (rest[..end].trim().to_string(), answer.to_string());
        }
    }
    (String::new(), text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_streamed_thought_is_marked() {
        assert!(is_thought(
            &json!({"content": "Weigh both.", "extra_content": {"google": {"thought": true}}})
        ));
        assert!(!is_thought(&json!({"content": "The second."})));
        assert!(!is_thought(
            &json!({"content": "", "extra_content": {"google": {"thought_signature": "s"}}})
        ));
    }

    #[test]
    fn a_whole_reply_opens_with_its_thought() {
        assert_eq!(
            split_whole("<think>\nWeigh both.\n</think>\n\nThe second."),
            ("Weigh both.".into(), "The second.".into())
        );
        assert_eq!(
            split_whole("a <think> b"),
            ("".into(), "a <think> b".into())
        );
        assert_eq!(
            split_whole("<think>never closed"),
            ("".into(), "<think>never closed".into())
        );
    }
}
