//! search_conversations: the user's earlier conversations with Textus AI,
//! searched for words when they refer to one ("the name we picked last
//! week", "as you suggested yesterday") - what was said there, where the
//! memory keeps only what should always hold.

use crate::ai::tools::{Access, Run, Tool, EVERY_MODE};
use crate::settings::chat_history::ChatHistory;
use aicompat::agent::ToolSpec;
use serde_json::{json, Value};

pub(crate) const SEARCH_CONVERSATIONS_TOOL_NAME: &str = "search_conversations";

/// Places shown to the model at most.
const SHOWN: usize = 8;

fn spec() -> ToolSpec {
    ToolSpec {
        name: SEARCH_CONVERSATIONS_TOOL_NAME.into(),
        description: "Search the user's earlier conversations with you - about every document, newest first - for words, when they refer to something said before that isn't in this conversation or in what you remember (\"the title we chose last time\", \"the names you suggested yesterday\"). Every word must be in one message or reply; search for a word or two that would be in it, in the language it was said in. Returns the passages found, with their conversation's title and date.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "A word or two that would be in what was said."
                }
            },
            "required": ["query"]
        }),
    }
}

/// When a conversation was last changed, as a date (UTC): days since
/// 1970 to year, month and day by the civil-from-days algorithm.
fn date(updated_at: &Value) -> String {
    let days = (updated_at.as_f64().unwrap_or(0.0) / 86_400_000.0).floor() as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

/// What the model is shown of the hits.
pub(crate) fn describe(query: &str, hits: &[Value]) -> String {
    if hits.is_empty() {
        return format!(
            "No earlier conversation has \"{query}\" in it. Try other words, or ask the user."
        );
    }
    let lines: Vec<String> = hits
        .iter()
        .take(SHOWN)
        .map(|hit| {
            let who = if hit["role"] == "user" {
                "the user"
            } else {
                "you"
            };
            format!(
                "- {} \"{}\" - {who} said: {}",
                date(&hit["updatedAt"]),
                hit["title"].as_str().unwrap_or(""),
                hit["snippet"].as_str().unwrap_or("")
            )
        })
        .collect();
    format!(
        "Earlier conversations with \"{query}\", newest first:\n{}",
        lines.join("\n")
    )
}

/// The tool, reading `history`.
pub(crate) fn search_conversations_tool(history: &ChatHistory) -> Tool<'_> {
    Tool {
        spec: spec(),
        access: Access::ReadOnly,
        modes: EVERY_MODE,
        run: Run::Async(Box::new(move |call| {
            Box::pin(async move {
                let args: Value = serde_json::from_str(&call.arguments).unwrap_or_default();
                let query = args["query"].as_str().unwrap_or("").trim().to_string();
                if query.is_empty() {
                    return "`query` is empty - search for a word or two."
                        .to_string()
                        .into();
                }
                describe(&query, &history.search(&query, SHOWN)).into()
            })
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_model_is_shown_who_said_it_when() {
        let hits = vec![json!({
            "id": "a", "title": "Lighthouse", "updatedAt": 1_760_000_000_000u64,
            "role": "user", "snippet": "Call her Lin."
        })];
        let text = describe("Lin", &hits);
        assert!(
            text.contains("2025-10-09 \"Lighthouse\" - the user said: Call her Lin."),
            "{text}"
        );
        assert!(describe("Lin", &[]).starts_with("No earlier conversation"));
        assert_eq!(date(&json!(0)), "1970-01-01");
        assert_eq!(date(&json!(951_782_400_000u64)), "2000-02-29");
    }
}
