//! What the writer will probably say next in a conversation, offered grey
//! in the empty message box after each reply (Tab takes it; typing drops
//! it), as Codex and Claude Code suggest a next prompt. One short request
//! to the conversation's model, the way the memory pass is
//! (memory/pass.rs).

use crate::ai::memory::Exchange;

const INSTRUCTIONS: &str = "You predict the next message a writer will send to their writing assistant, from the conversation so far. Write that one message as they would type it: short (at most 15 words, or 30 characters in Chinese or Japanese), in the language they write their messages in, plain text with no quotes. Make it the natural next step - go on with the next part, change something in what was just done, or a follow-up question - never a thank-you or a goodbye. If there is no clear next step, answer NONE.";

/// The last few messages are enough to see where the conversation goes.
const MESSAGES_SENT: usize = 4;

/// A suggestion longer than this isn't a message the writer would type.
const LONGEST: usize = 80;

fn input(exchange: &Exchange) -> String {
    let start = exchange.messages.len().saturating_sub(MESSAGES_SENT);
    let mut text = String::from("The writer's messages, oldest first:\n");
    for message in &exchange.messages[start..] {
        text.push_str(&format!("- {}\n", clip(message, 600)));
    }
    text.push_str(&format!(
        "\nThe assistant's reply to the last one:\n{}\n\nTheir next message:",
        clip(&exchange.reply, 1500)
    ));
    text
}

fn clip(text: &str, chars: usize) -> String {
    let text = text.trim();
    match text.char_indices().nth(chars) {
        Some((at, _)) => format!("{}…", &text[..at]),
        None => text.to_string(),
    }
}

/// The model's answer as one message to offer, or None: NONE, nothing,
/// or something too long to be a typed message.
pub(crate) fn suggestion(answer: &str) -> Option<String> {
    let line = answer.lines().map(str::trim).find(|l| !l.is_empty())?;
    let line = line
        .trim_start_matches(['-', '*', '>'])
        .trim()
        .trim_matches(['"', '\'', '“', '”', '「', '」', '`'])
        .trim();
    if line.is_empty() || line.eq_ignore_ascii_case("none") || line.chars().count() > LONGEST {
        return None;
    }
    Some(line.to_string())
}

/// The message the writer will probably send next, or None.
#[tauri::command]
pub async fn suggest_next_message(
    app: tauri::AppHandle,
    provider: String,
    model: Option<String>,
    exchange: Exchange,
) -> Result<Option<String>, String> {
    crate::ai::ensure_on(&app)?;
    if exchange.messages.is_empty() || exchange.reply.trim().is_empty() {
        return Ok(None);
    }
    let answer = crate::ai::client::call(
        &app,
        &provider,
        INSTRUCTIONS.to_string(),
        input(&exchange),
        model.as_deref(),
    )
    .await?;
    Ok(suggestion(&answer))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_answer_is_one_short_message_or_nothing() {
        assert_eq!(suggestion("继续写第三章").as_deref(), Some("继续写第三章"));
        assert_eq!(
            suggestion("\n\"Make the ending darker\"\n").as_deref(),
            Some("Make the ending darker")
        );
        assert_eq!(
            suggestion("「把标题改短一点」").as_deref(),
            Some("把标题改短一点")
        );
        assert_eq!(
            suggestion("- Translate it into French").as_deref(),
            Some("Translate it into French")
        );
        assert_eq!(suggestion("NONE"), None);
        assert_eq!(suggestion("   "), None);
        assert_eq!(suggestion(&"很长".repeat(50)), None);
    }

    #[test]
    fn only_the_last_messages_and_the_reply_are_sent() {
        let exchange = Exchange {
            messages: (1..=6).map(|n| format!("message {n}")).collect(),
            reply: "Done.".into(),
        };
        let text = input(&exchange);
        assert!(!text.contains("message 2"));
        assert!(text.contains("message 3") && text.contains("message 6"));
        assert!(text.contains("Done."));
    }
}
