//! What kind of failure a provider's error is, from the list the frontend
//! reads too (src/ai/ai-error-kinds.json): first match wins.

use regex::Regex;
use std::sync::LazyLock;

static KINDS: LazyLock<Vec<(String, Regex)>> = LazyLock::new(|| {
    let list: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../../../src/ai/ai-error-kinds.json"))
            .expect("ai-error-kinds.json");
    list.iter()
        .map(|entry| {
            let kind = entry["kind"].as_str().expect("kind").to_string();
            let pattern = entry["pattern"].as_str().expect("pattern");
            (
                kind,
                Regex::new(&format!("(?i){pattern}")).expect("pattern"),
            )
        })
        .collect()
});

/// The kind `error` reads as ("rateLimit", "auth", ...), if any.
pub fn kind(error: &str) -> Option<&'static str> {
    KINDS
        .iter()
        .find(|(_, pattern)| pattern.is_match(error))
        .map(|(kind, _)| kind.as_str())
}

#[cfg(test)]
mod tests {
    use super::kind;

    #[test]
    fn errors_read_as_the_frontend_reads_them() {
        assert_eq!(kind("request failed (429): slow down"), Some("rateLimit"));
        // A used-up balance sent as a 429 is a balance problem.
        assert_eq!(
            kind("request failed (429): You exceeded your current quota"),
            Some("balance")
        );
        assert_eq!(kind("request failed (401): bad key"), Some("auth"));
        assert_eq!(kind("request failed (503): busy"), Some("server"));
        assert_eq!(kind("tools are not supported"), None);
    }
}
