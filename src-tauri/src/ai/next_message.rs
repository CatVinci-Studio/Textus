//! What the writer will probably say next in a conversation, after each
//! reply: the first grey in the empty message box, all of them as buttons
//! over it. One short request to the conversation's model. The list is read
//! by `useNextMessage` (src/ai/chat/next-message.ts).

use crate::ai::memory::Exchange;

const INSTRUCTIONS: &str = "You predict the next message a writer will send to their writing assistant, from the conversation so far. Give up to three different ones, one per line, most likely first, each as they would type it: short (at most 6 words, or 15 characters in Chinese or Japanese), in the language they write their messages in, plain text with no quotes or numbering. Make each a concrete next step on their document - go on with the next part, change something in what was just done, or a follow-up question - never a thank-you or a goodbye, and never asking again for what the assistant just did: what it wrote or changed is already in the document. If there is no clear next step, answer NONE.";

/// The last few messages are enough to see where the conversation goes.
const MESSAGES_SENT: usize = 4;

/// A suggestion longer than this isn't a message the writer would type.
const LONGEST: usize = 80;

/// As many as fit as buttons over the message box.
const MOST: usize = 3;

fn input(exchange: &Exchange) -> String {
    let start = exchange.messages.len().saturating_sub(MESSAGES_SENT);
    let mut text = String::from("The writer's messages, oldest first:\n");
    for message in &exchange.messages[start..] {
        text.push_str(&format!("- {}\n", clip(message, 600)));
    }
    text.push_str(&format!(
        "\nThe assistant's reply to the last one (what it wrote or changed is already in the document):\n{}\n\nTheir next messages:",
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

/// One line of the answer as a message to offer, or None: NONE, nothing,
/// or something too long to be a typed message.
fn suggestion(line: &str) -> Option<String> {
    let line = line
        .trim()
        .trim_start_matches(['-', '*', '>', '•'])
        .trim_start();
    // "1." / "2)" numbering, which the model adds despite being asked not to.
    let digits = line.len() - line.trim_start_matches(|c: char| c.is_ascii_digit()).len();
    let line = match line[digits..].strip_prefix(['.', ')', '、']) {
        Some(rest) if digits > 0 => rest,
        _ => line,
    };
    let line = line
        .trim()
        .trim_matches(['"', '\'', '“', '”', '「', '」', '`'])
        .trim();
    if line.is_empty() || line.eq_ignore_ascii_case("none") || line.chars().count() > LONGEST {
        return None;
    }
    Some(line.to_string())
}

/// The model's answer as up to three different messages, most likely first.
pub(crate) fn suggestions(answer: &str) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    for line in answer.lines().filter_map(suggestion) {
        if !found
            .iter()
            .any(|f| f.to_lowercase() == line.to_lowercase())
        {
            found.push(line);
        }
        if found.len() == MOST {
            break;
        }
    }
    found
}

/// The messages the writer will probably send next, most likely first;
/// empty when there is no clear next step.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn suggest_next_message(
    app: tauri::AppHandle,
    provider: String,
    model: Option<String>,
    exchange: Exchange,
) -> Result<Vec<String>, String> {
    crate::ai::ensure_on(&app)?;
    if exchange.messages.is_empty() || exchange.reply.trim().is_empty() {
        return Ok(Vec::new());
    }
    let answer = crate::ai::client::call(
        &app,
        &provider,
        INSTRUCTIONS.to_string(),
        input(&exchange),
        model.as_deref(),
    )
    .await?;
    Ok(suggestions(&answer))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_line_is_one_short_message_or_nothing() {
        assert_eq!(suggestion("继续写第三章").as_deref(), Some("继续写第三章"));
        assert_eq!(
            suggestion("\"Make the ending darker\"").as_deref(),
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
        assert_eq!(
            suggestion("2. Add a summary at the top").as_deref(),
            Some("Add a summary at the top")
        );
        assert_eq!(suggestion("1、缩短这一节").as_deref(), Some("缩短这一节"));
        assert_eq!(suggestion("3D charts").as_deref(), Some("3D charts"));
        assert_eq!(suggestion("NONE"), None);
        assert_eq!(suggestion("   "), None);
        assert_eq!(suggestion(&"很长".repeat(50)), None);
    }

    #[test]
    fn the_answer_is_up_to_three_different_messages() {
        assert_eq!(
            suggestions("\n1. Shorten this section\n2. Add a summary at the top\n\n- shorten this section\n3. Fix the title\n4. Translate it"),
            ["Shorten this section", "Add a summary at the top", "Fix the title"]
        );
        assert_eq!(suggestions("继续写第三章"), ["继续写第三章"]);
        assert!(suggestions("NONE").is_empty());
        assert!(suggestions("").is_empty());
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
