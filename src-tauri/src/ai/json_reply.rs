//! The JSON a model's reply carries, however it is wrapped - a code fence,
//! a sentence before or after it. Every request that asks a model for a
//! JSON answer in plain text reads it here: the memory pass, the skill
//! offer, Research's genre, questions and opening.

use serde::de::DeserializeOwned;

/// The JSON object in `reply` - from its first `{` to its last `}` - as a
/// `T`; None when there is none, or it isn't one.
pub(crate) fn object<T: DeserializeOwned>(reply: &str) -> Option<T> {
    between(reply, '{', '}')
}

/// The JSON array in `reply` - from its first `[` to its last `]` - as a
/// `T`; None when there is none, or it isn't one.
pub(crate) fn array<T: DeserializeOwned>(reply: &str) -> Option<T> {
    between(reply, '[', ']')
}

fn between<T: DeserializeOwned>(reply: &str, open: char, close: char) -> Option<T> {
    let (start, end) = (reply.find(open)?, reply.rfind(close)?);
    serde_json::from_str(reply.get(start..=end)?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn the_json_is_read_out_of_whatever_wraps_it() {
        let fenced = "Here it is:\n```json\n{\"a\": [1, 2]}\n```\nDone.";
        assert_eq!(object::<Value>(fenced), Some(json!({"a": [1, 2]})));
        assert_eq!(
            array::<Vec<String>>("Questions: [\"one\", \"two\"]."),
            Some(vec!["one".to_string(), "two".to_string()])
        );
    }

    #[test]
    fn a_reply_without_json_of_that_shape_has_none() {
        assert_eq!(object::<Value>("I can't tell."), None);
        // A closing brace before the opening one is no object.
        assert_eq!(object::<Value>("} then {"), None);
        assert_eq!(object::<Value>("{not json}"), None);
        assert_eq!(array::<Vec<String>>("[1, 2]"), None);
    }
}
