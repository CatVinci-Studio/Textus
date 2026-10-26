//! Tidying a provider's `/models` listing into what a model picker should
//! offer: every provider's endpoint answers in its own shape and mixes chat
//! models with embedding, speech, image-generation and moderation ones.

/// Fragments of model ids that are never chat models. Conservative: a
/// listed model that slips through is harmless, a chat model wrongly hidden
/// is not (the user can still type any id by hand).
const NON_CHAT: &[&str] = &[
    "embed",
    "tts",
    "whisper",
    "transcri",
    "dall-e",
    "gpt-image",
    "-image",
    "image-",
    "imagen",
    "moderation",
    "rerank",
    "realtime",
    "-audio",
    "audio-",
    "speech",
    "veo-",
    "sora",
    "lyria",
    "babbage",
    "davinci-002",
    "guard",
];

fn is_chat_model(id: &str) -> bool {
    let id = id.to_lowercase();
    !NON_CHAT.iter().any(|fragment| id.contains(fragment))
}

/// `(id, sort key)` pairs -> the ids a picker should show: Gemini's `models/`
/// prefix stripped, non-chat models and duplicates dropped, newest first when
/// the provider gives a creation key, otherwise in the provider's order.
pub fn tidy(entries: Vec<(String, Option<String>)>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut kept: Vec<(String, Option<String>)> = entries
        .into_iter()
        .map(|(id, key)| (id.trim_start_matches("models/").to_string(), key))
        .filter(|(id, _)| !id.is_empty() && is_chat_model(id) && seen.insert(id.clone()))
        .collect();
    if kept.iter().all(|(_, key)| key.is_some()) {
        kept.sort_by(|a, b| b.1.cmp(&a.1));
    }
    kept.into_iter().map(|(id, _)| id).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_non_chat_models_and_prefixes_and_sorts_newest_first() {
        let listed = vec![
            (
                "models/gemini-3.8-flash".to_string(),
                Some("0300".to_string()),
            ),
            (
                "text-embedding-3-large".to_string(),
                Some("0100".to_string()),
            ),
            ("gpt-image-2".to_string(), Some("0400".to_string())),
            ("gpt-6-luna".to_string(), Some("0350".to_string())),
            ("whisper-1".to_string(), Some("0200".to_string())),
            ("gpt-6-luna".to_string(), Some("0350".to_string())),
        ];
        assert_eq!(tidy(listed), ["gpt-6-luna", "gemini-3.8-flash"]);
    }

    #[test]
    fn keeps_provider_order_without_dates() {
        let listed = vec![("b".to_string(), None), ("a".to_string(), None)];
        assert_eq!(tidy(listed), ["b", "a"]);
    }
}
