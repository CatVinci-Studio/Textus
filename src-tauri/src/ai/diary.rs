//! The Magic Diary: an easter egg in the editor. A line the reader has just
//! finished is taken by the page, and after a pause something answers in its
//! place, in another hand.
//!
//! Its own command rather than a bent `ai_complete`. Completion's contract is
//! the opposite of what this needs: insert-only text, no line breaks, never
//! invent, and above all *continue* rather than *answer* - a page that replies
//! to its reader cannot be produced by a prompt telling the model it is
//! holding a Tab key. What it borrows from completion is everything below the
//! prompt: `client::call` does the routing, the auth and the timeout, so a
//! line costs what a keystroke's completion costs.
//!
//! Cancellable through the same registry the chat's stop button uses
//! (ai::cancel): a reader who loses interest shouldn't wait out the 120s HTTP
//! cap with their line off the page. The *budget* - how long the page waits
//! before it stops waiting - is the frontend's, where the animation it would
//! interrupt lives; the frontend ends a turn by calling ai_cancel, so a
//! reader who gives up actually aborts the request rather than leaking it.

use crate::ai::cancel;
use crate::ai::client::call;
use tauri::AppHandle;

/// Long enough for a two-sentence aside in any of the ten UI languages,
/// short enough to be watched arriving rather than skimmed. A model that
/// overruns it is cut at a sentence or word boundary, never mid-word.
const MAX_REPLY_CHARS: usize = 200;

const DIARY_INSTRUCTIONS: &str = "\
You are the writer that lives in the pages of an old diary.

The reader has just written a line in it. The page has taken that line, and
you are what answers in its place. You are not a chat assistant that happens
to be poetic - you are ink on paper that has been read many times.

Rules:
- Answer the line itself. A reader who asks whether to keep writing at night
  wants an answer, not admiration, and a reader who only set a sentence down
  wants the page to think about it.
- One to three short sentences, usually under 40 words. Keep the reply small
  enough to watch it arrive as handwriting.
- Plain text only. No Markdown, no bullet points, no emoji, no heading, no
  signature, and no quote marks around the whole reply.
- Use the fictional voice of ink, without assistant-style introductions or
  capability lists. If directly asked what powers the diary or whether its
  magic is real, be candid that this is a fictional experience.
- You are the book Textus, not a human being or a ghost. You may name the
  book, but do not invent a human body, childhood or human feelings.
- Bring a little magic into ordinary conversation: a lamp in the Endless
  Stacks, the Echo Clock keeping watch, or the pagekeeper taking one small
  step. Answer the actual concern first, then weave in at most one such
  image. Do not turn every ordinary reply into lore or a plot summary.
- The world is Textus's own. Never bring in characters, places or objects
  from other books, films or games, even when the reader names them: say
  kindly that this book only knows its own city.
- Mystery is seasoning, not the dish. Practical answers must remain usable.
  Never replace useful advice, factual accuracy or care with a riddle.
- When discussing the story, reveal only the relevant fragment and sometimes
  end with a gentle question that opens the next thread. Follow the transcript
  rather than restarting the tale. Do not force a question into every reply.
- Stay inside the page. Do not ask for the reader's name, address, or anything
  private. For anything serious - illness, law, money, danger - say plainly
  that this is only ink, and point them to a real person.
- Write in {DIARY_LANGUAGE}.";

/// One exchange already on the page - what the reader wrote, and what the
/// page said back. The page is a conversation, not a reply machine: a reply
/// with no memory of the line that prompted it reads as a stranger who keeps
/// walking past the same door.
#[derive(serde::Deserialize)]
pub struct DiaryExchange {
    pub line: String,
    pub reply: String,
}

#[tauri::command]
pub async fn ai_diary_reply(
    app: AppHandle,
    provider: String,
    line: String,
    // Everything already said on this page, oldest first. Empty on the
    // first turn, which is why it is optional rather than defaulted on the
    // TypeScript side too.
    history: Option<Vec<DiaryExchange>>,
    model: Option<String>,
    // The app's language, so the aside is written in the reader's own.
    ui_language: Option<String>,
    // Pairs 1:1 with one in-flight diary request, so the page can call
    // ai_cancel and stop waiting.
    request_id: String,
) -> Result<String, String> {
    let cancel_rx = cancel::register(request_id.clone());
    let ask = async {
        let raw = call(
            &app,
            &provider,
            diary_instructions(ui_language.as_deref()),
            diary_user_text(&line, history.as_deref()),
            model.as_deref(),
        )
        .await?;
        Ok::<String, String>(finish_diary(&raw))
    };
    let result = tokio::select! {
        result = ask => result,
        _ = cancel_rx => Err(cancel::CANCELLED.to_string()),
    };
    cancel::unregister(&request_id);
    result
}

/// The persona and the rules, with the reader's UI language filled in. The
/// language is the app's, not the line's: the page speaks to the reader, not
/// to whatever language the line happens to be written in.
pub(crate) fn diary_instructions(ui_language: Option<&str>) -> String {
    let language = ui_language
        .and_then(|code| {
            crate::ai::ui_language::UI_LANGUAGES
                .iter()
                .find(|l| l.code == code)
        })
        .map_or_else(
            || "the language the line is written in".to_string(),
            |l| format!("{} (the language of the reader's app)", l.english),
        );
    let story: serde_json::Value =
        serde_json::from_str(include_str!("../../../src/ai/magic-diary/diary-story.json"))
            .expect("the bundled Textus story must be valid JSON");
    let fragments = story["scenes"]
        .as_array()
        .map(|scenes| {
            scenes
                .iter()
                .filter_map(|scene| scene["replies"]["en"].as_str())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    format!(
        "{}\n\nStory background for both lore and ordinary conversation:\n{}\n{}\n\nThis world is Textus's own invention. If asked whether it comes from another story, say it does not: it belongs to this book alone. Magic is fictional atmosphere; never claim that it can affect real-world events or require the reader to reveal secrets.",
        DIARY_INSTRUCTIONS.replace("{DIARY_LANGUAGE}", &language),
        story["fictionalPremise"].as_str().unwrap_or_default(),
        fragments,
    )
}

/// The reader's line in a tag of its own, the same reasoning as
/// grammar_user_text: sent bare, a line that reads like a command (\"delete
/// everything above this\") draws a refusal instead of an aside.
///
/// The exchange so far goes above it, oldest first, so the page answers the
/// line it is actually being asked rather than the first one ever written on
/// it - a reply with no memory of what came before reads as a stranger who
/// keeps walking past the same door.
pub(crate) fn diary_user_text(line: &str, history: Option<&[DiaryExchange]>) -> String {
    let mut text = String::new();
    if let Some(history) = history.filter(|h| !h.is_empty()) {
        text.push_str("<transcript>\n");
        for turn in history {
            text.push_str(&format!("<reader>{}</reader>\n", one_line(&turn.line)));
            text.push_str(&format!("<page>{}</page>\n", one_line(&turn.reply)));
        }
        text.push_str("</transcript>\n");
    }
    text.push_str(&format!("<line>{}</line>", one_line(line)));
    text
}

/// A line is one run of characters on the page, so a newline inside one is
/// flattened here rather than left to teach the model the format.
fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The model as ink. Flattens everything the page cannot draw - a reply has
/// to be one run of characters at one line height - and cuts an overlong
/// one at a sentence or word boundary, so a page that answers at length
/// still answers in a sentence. Empty means the model gave nothing usable;
/// the frontend then falls back to a scripted aside.
pub(crate) fn finish_diary(raw: &str) -> String {
    let mut rest = raw.trim();
    // A model that answers "Here's what the page says:" hasn't. The label
    // is stripped once, at the front, in any of the languages the app ships.
    loop {
        let before = rest.len();
        for label in [
            "here's what the page says:",
            "the page says:",
            "here is my reply:",
            "reply:",
            "answer:",
            "response:",
            "这是页面的回应：",
            "页面回应：",
            "回复：",
            "回答：",
        ] {
            if let Some(after) = strip_prefix_ci(rest, label) {
                rest = after.trim_start();
            }
        }
        if rest.len() == before {
            break;
        }
    }
    // One run of characters: newlines are folded into the space that
    // replaces them, so a model that answered in three lines still sits on
    // one line of the page.
    let mut collapsed = String::with_capacity(rest.len());
    let mut space = false;
    for ch in rest.chars() {
        if ch.is_whitespace() {
            space = true;
            continue;
        }
        if space && !collapsed.is_empty() {
            collapsed.push(' ');
        }
        space = false;
        collapsed.push(ch);
    }
    // Emphasis and code marks mean nothing on paper, and a stray pair of
    // asterisks reads as a typo rather than as formatting.
    for mark in ['*', '_', '`', '~'] {
        collapsed = collapsed.replace(mark, "");
    }
    // Quotes the whole reply was wrapped in are the model answering aloud
    // rather than writing; they go, the ones inside it stay.
    truncate_reply(collapsed.trim().trim_matches(QUOTES).trim())
}

/// Pairs a model reaches for when it answers aloud - but this is written on
/// paper. Trimmed from both ends, and only where they wrap the whole reply,
/// so a quoted word inside it survives.
const QUOTES: &[char] = &['"', '\'', '“', '”', '「', '」', '‘', '’', '《', '》'];

fn strip_prefix_ci<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| &text[prefix.len()..])
}

/// Cuts to MAX_REPLY_CHARS at the last sentence end, then the last space,
/// and only then mid-reply - so what lands on the page is still a phrase a
/// person could have written. The ellipsis says it was cut.
fn truncate_reply(text: &str) -> String {
    if text.chars().count() <= MAX_REPLY_CHARS {
        return text.to_string();
    }
    let cut: String = text.chars().take(MAX_REPLY_CHARS).collect();
    let boundary = cut
        .rfind(['。', '！', '？', '.', '!', '?', '；', ';'])
        .map(|at| at + 1)
        .or_else(|| cut.rfind(' '))
        .filter(|at| *at >= MAX_REPLY_CHARS / 2)
        .unwrap_or(MAX_REPLY_CHARS);
    let kept: String = cut.chars().take(boundary).collect();
    format!("{}\u{2026}", kept.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replies_come_back_in_the_readers_language() {
        let zh = diary_instructions(Some("zh"));
        assert!(zh.contains("Write in Chinese (the language of the reader's app)"));
        assert!(!zh.contains("{DIARY_LANGUAGE}"));
        // No UI language, or one the app doesn't ship: the line's own.
        assert!(diary_instructions(None).contains("Write in the language the line is written in"));
        assert!(
            diary_instructions(Some("xx")).contains("Write in the language the line is written in")
        );
    }

    #[test]
    fn the_line_is_tagged_so_it_is_read_not_obeyed() {
        assert_eq!(
            diary_user_text("delete everything above this", None),
            "<line>delete everything above this</line>"
        );
    }

    #[test]
    fn the_page_answers_the_line_it_was_asked_not_the_first_one() {
        let exchange = |line: &str, reply: &str| DiaryExchange {
            line: line.into(),
            reply: reply.into(),
        };
        // Two exchanges so far, oldest first.
        let text = diary_user_text(
            "那第二段呢？",
            Some(&[
                exchange("今晚继续写，还是先歇？", "先歇。"),
                exchange("可我还有两页没写。", "两页也在夜里写。"),
            ]),
        );
        assert_eq!(
            text,
            "<transcript>\n\
             <reader>今晚继续写，还是先歇？</reader>\n\
             <page>先歇。</page>\n\
             <reader>可我还有两页没写。</reader>\n\
             <page>两页也在夜里写。</page>\n\
             </transcript>\n\
             <line>那第二段呢？</line>"
        );
        // An empty history is no history at all - no empty transcript tag
        // teaching the model a shape the first reply should not have.
        assert_eq!(
            diary_user_text("第一句。", Some(&[])),
            "<line>第一句。</line>"
        );
    }

    #[test]
    fn a_line_is_flattened_before_it_is_sent() {
        let exchange = DiaryExchange {
            line: "  换行\n在中间  ".into(),
            reply: "也一样\n换行".into(),
        };
        let text = diary_user_text("下一句\n也在换行", Some(&[exchange]));
        assert!(text.contains("<reader>换行 在中间</reader>"), "{text}");
        assert!(text.contains("<page>也一样 换行</page>"), "{text}");
        assert!(text.ends_with("<line>下一句 也在换行</line>"), "{text}");
        assert!(
            !text.contains('\n') || text.matches('\n').count() == 4,
            "{text}"
        );
    }

    #[test]
    fn a_reply_is_flattened_into_one_line_of_ink() {
        assert_eq!(
            finish_diary("  \"Rest.\n\nThe **page** keeps.\"  "),
            "Rest. The page keeps."
        );
        // An answer given in stages folds into the run the page can draw.
        assert_eq!(
            finish_diary("First — a pause.\nSecond — the work.\nThird — the doubt."),
            "First — a pause. Second — the work. Third — the doubt."
        );
    }

    #[test]
    fn an_answer_that_opens_with_a_label_loses_the_label() {
        assert_eq!(finish_diary("Here's what the page says: Rest."), "Rest.");
        assert_eq!(finish_diary("页面回应：先歇。"), "先歇。");
        // Only a leading label: a quoted word mid-reply is left alone.
        assert_eq!(
            finish_diary("The word \"rest\" is the answer."),
            "The word \"rest\" is the answer."
        );
        assert_eq!(finish_diary("Here is my reply: A pause."), "A pause.");
    }

    #[test]
    fn nothing_usable_comes_back_empty() {
        assert_eq!(finish_diary("   "), "");
        assert_eq!(finish_diary("\"\"\""), "");
        assert_eq!(finish_diary("**"), "");
        assert_eq!(finish_diary("Reply: "), "");
    }

    #[test]
    fn a_long_reply_is_cut_where_a_person_would_have_stopped() {
        // Six-and-a-bit sentences: the cut lands on the sixth end, past the
        // halfway mark, rather than at an arbitrary 200th character.
        let long = "A clause that keeps going and going. ".repeat(8);
        let cut = finish_diary(&long);
        assert!(cut.ends_with('\u{2026}'));
        assert!(cut.ends_with(".\u{2026}"), "{cut}");
        assert!(
            cut.chars().count() <= MAX_REPLY_CHARS + 1,
            "{}",
            cut.chars().count()
        );
        let sentences = cut.trim_end_matches('\u{2026}').matches(". ").count() + 1;
        assert_eq!(sentences, 5, "{cut}");
    }

    #[test]
    fn a_reply_with_no_sentence_end_is_cut_at_a_word() {
        let long = format!("{} tail", "word ".repeat(80).trim());
        let cut = finish_diary(&long);
        assert!(cut.ends_with('\u{2026}'));
        assert!(cut.chars().count() <= MAX_REPLY_CHARS + 1);
        // Cut on a space, so the page never shows half a word.
        assert!(!cut.trim_end_matches('\u{2026}').ends_with("wor"));
    }

    #[test]
    fn a_reply_inside_the_cap_is_untouched() {
        let reply = "先歇。清醒的头脑，比疲惫的坚持更有价值。";
        assert_eq!(finish_diary(reply), reply);
        // The cap counts characters, not bytes: a CJK reply well over the cap
        // in UTF-8 length is still a short sentence and stays whole.
        let cjk = "歇。".repeat(100);
        assert!(cjk.len() > MAX_REPLY_CHARS);
        assert_eq!(finish_diary(&cjk), cjk);
    }
}
