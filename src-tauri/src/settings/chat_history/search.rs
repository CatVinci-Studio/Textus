//! Searching saved conversations' messages and replies, newest first, for the
//! history list and for Textus AI's search_conversations.

use super::*;

/// The words around a match a result shows, before and after it.
const BEFORE: usize = 40;
const AFTER: usize = 100;

/// What a search found in one conversation: the conversation, the turn
/// the words are in ("user" or "assistant"), and the words around them.
pub fn found(entry: &Value, role: &str, snippet: String) -> Value {
    json!({
        "id": entry["id"],
        "docPath": entry.get("docPath").cloned().unwrap_or(Value::Null),
        "title": entry.get("title").cloned().unwrap_or(json!("")),
        "updatedAt": entry["updatedAt"],
        "role": role,
        "snippet": snippet,
    })
}

/// `text` around its first `term`, on one line, with … where it was cut.
fn snippet(text: &str, lower: &str, term: &str) -> String {
    let at = lower.find(term).unwrap_or(0);
    // Byte offsets in the lowercased text may not match the original's, so count
    // characters.
    let at_char = lower[..at].chars().count();
    let chars: Vec<char> = text.chars().collect();
    let start = at_char.saturating_sub(BEFORE);
    let end = (at_char + term.chars().count() + AFTER).min(chars.len());
    let mut out: String = chars[start.min(chars.len())..end].iter().collect();
    out = out.split_whitespace().collect::<Vec<_>>().join(" ");
    if start > 0 {
        out.insert(0, '…');
    }
    if end < chars.len() {
        out.push('…');
    }
    out
}

/// The query's words, lowercased: every one must be in a turn.
pub fn terms(query: &str) -> Vec<String> {
    query
        .split_whitespace()
        .map(str::to_lowercase)
        .filter(|t| !t.is_empty())
        .collect()
}

/// The first turn of `entry` with every term in it, as a result.
pub fn search_entry(entry: &Value, terms: &[String]) -> Option<Value> {
    for turn in entry["turns"].as_array()? {
        let role = match turn["kind"].as_str() {
            Some("User") => "user",
            Some("Assistant") => "assistant",
            _ => continue,
        };
        let Some(text) = turn["text"].as_str() else {
            continue;
        };
        let lower = text.to_lowercase();
        if terms.iter().all(|t| lower.contains(t.as_str())) {
            return Some(found(entry, role, snippet(text, &lower, &terms[0])));
        }
    }
    None
}

impl ChatHistory {
    /// The conversations with every word of `query` in one of their
    /// messages or replies, newest first, at most `limit`.
    pub fn search(&self, query: &str, limit: usize) -> Vec<Value> {
        let terms = terms(query);
        if terms.is_empty() {
            return Vec::new();
        }
        let list = self.list();
        let ids = list
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|e| id_str(e).map(str::to_owned));
        let mut hits = Vec::new();
        for id in ids {
            if let Some(hit) = self.get(&id).and_then(|e| search_entry(&e, &terms)) {
                hits.push(hit);
                if hits.len() >= limit {
                    break;
                }
            }
        }
        hits
    }
}
