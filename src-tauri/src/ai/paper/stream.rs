//! What the stages' streams show on the card as they come: the tail of the
//! thinking, and strings read out of a tool call's JSON arguments while
//! they still arrive - a few times a second at most, since tokens come far
//! faster than a card needs to redraw.

use super::PaperEvent;
use std::str::CharIndices;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// When a watcher last sent, so it sends at most once every so often.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct LastSent(Option<Instant>);

impl LastSent {
    /// Whether a send now would come at least `every` after the last.
    pub(crate) fn due(&self, every: Duration) -> bool {
        self.0.is_none_or(|at| at.elapsed() >= every)
    }

    /// A send is made now.
    pub(crate) fn now(&mut self) {
        self.0 = Some(Instant::now());
    }
}

/// How much of the planner's stream a Thinking event carries: its tail.
const THINKING_TAIL: usize = 160;
/// The least time between two Thinking events.
const THINKING_EVERY: Duration = Duration::from_millis(250);

/// Gathers a stream's fragments and sends their tail as Thinking.
pub(crate) struct ThinkingTail<'a> {
    send: &'a (dyn Fn(PaperEvent) + Sync),
    state: Mutex<(String, LastSent)>,
}

impl<'a> ThinkingTail<'a> {
    pub(crate) fn new(send: &'a (dyn Fn(PaperEvent) + Sync)) -> Self {
        Self {
            send,
            state: Mutex::default(),
        }
    }

    pub(crate) fn push(&self, fragment: &str) {
        let text = {
            let mut state = self.state.lock().unwrap();
            let (text, last) = &mut *state;
            text.push_str(fragment);
            // Keep the buffer bounded: only its tail is ever sent.
            if text.len() > THINKING_TAIL * 8 {
                *text = tail(text, THINKING_TAIL * 2).to_string();
            }
            if !last.due(THINKING_EVERY) {
                return;
            }
            last.now();
            tail(text, THINKING_TAIL).to_string()
        };
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if !text.is_empty() {
            (self.send)(PaperEvent::Thinking { text });
        }
    }
}

/// The last `chars` characters of `text`.
pub(crate) fn tail(text: &str, chars: usize) -> &str {
    let skip = text.chars().count().saturating_sub(chars);
    text.char_indices()
        .nth(skip)
        .map_or(text, |(i, _)| &text[i..])
}

/// What follows a key in JSON still arriving.
#[derive(Debug, PartialEq)]
pub(crate) enum AfterKey {
    /// Not enough has come to tell.
    Pending,
    /// No string value: read on from `at`.
    Other { at: usize },
    /// A string, unescaped as far as it has come; `end`, just past its
    /// closing quote, once it is whole.
    Text { text: String, end: Option<usize> },
}

/// What follows a key, `text` starting right after it.
pub(crate) fn after_key(text: &str) -> AfterKey {
    let colon = text.len() - text.trim_start().len();
    let Some(value) = text[colon..].strip_prefix(':') else {
        return other_or_pending(text, colon);
    };
    let open = text.len() - value.trim_start().len();
    let Some(body) = text[open..].strip_prefix('"') else {
        return other_or_pending(text, open);
    };
    let (unescaped, close) = unescape(body);
    AfterKey::Text {
        text: unescaped,
        end: close.map(|i| open + 1 + i + 1),
    }
}

fn other_or_pending(text: &str, at: usize) -> AfterKey {
    if at == text.len() {
        AfterKey::Pending
    } else {
        AfterKey::Other { at }
    }
}

/// The string value of `key` in JSON still arriving, as far as it has
/// come; "" before it starts.
pub(crate) fn string_value(json: &str, key: &str) -> String {
    let Some(at) = json.find(key) else {
        return String::new();
    };
    match after_key(&json[at + key.len()..]) {
        AfterKey::Text { text, .. } => text,
        _ => String::new(),
    }
}

/// A JSON string's body, cut anywhere, unescaped as far as it has come,
/// and where its closing quote is once that has come. An escape cut in
/// half waits for the rest; a carriage return is left out, as the text is
/// shown in lines.
fn unescape(body: &str) -> (String, Option<usize>) {
    let mut out = String::with_capacity(body.len());
    let mut chars = body.char_indices();
    while let Some((i, c)) = chars.next() {
        let c = match c {
            '"' => return (out, Some(i)),
            '\\' => match chars.next().map(|(_, c)| c) {
                Some('n') => '\n',
                Some('t') => '\t',
                Some('r') => continue,
                Some('u') => match escaped_char(&mut chars) {
                    Some(Some(c)) => c,
                    // Not a character: left out.
                    Some(None) => continue,
                    None => break,
                },
                Some(other) => other,
                None => break,
            },
            c => c,
        };
        out.push(c);
    }
    (out, None)
}

/// The character a `\u` escape stands for, read from `chars` after the
/// `\u` - with the low half of a surrogate pair after its high half.
/// Some(None) when it stands for none; None while it is cut.
fn escaped_char(chars: &mut CharIndices<'_>) -> Option<Option<char>> {
    let rest = chars.as_str();
    let code = hex4(rest)?;
    let skip = |chars: &mut CharIndices<'_>, n: usize| {
        chars.nth(n - 1);
    };
    let Some(high @ 0xD800..=0xDBFF) = code else {
        skip(chars, 4);
        return Some(code.and_then(char::from_u32));
    };
    let after = &rest[4..];
    let low = match after.strip_prefix("\\u") {
        Some(low) => hex4(low)?,
        None if "\\u".starts_with(after) => return None,
        None => None,
    };
    match low.filter(|low| (0xDC00..=0xDFFF).contains(low)) {
        Some(low) => {
            skip(chars, 10);
            Some(char::from_u32(
                0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00),
            ))
        }
        // Half a pair.
        None => {
            skip(chars, 4);
            Some(None)
        }
    }
}

/// The four hex digits `s` starts with: Some(None) when they aren't hex,
/// None while fewer have come.
fn hex4(s: &str) -> Option<Option<u32>> {
    let digits: String = s.chars().take(4).collect();
    if digits.chars().count() < 4 {
        return None;
    }
    Some(
        Some(digits)
            .filter(|d| d.chars().all(|c| c.is_ascii_hexdigit()))
            .and_then(|d| u32::from_str_radix(&d, 16).ok()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_string_is_read_as_far_as_it_has_come() {
        assert_eq!(
            string_value(r#"{"markdown": "Line one\nsays \"hi\" é"#, "\"markdown\""),
            "Line one\nsays \"hi\" é"
        );
        // An escape cut in half waits for the rest.
        for cut in [r#""ab\u00"#, r#""ab\"#, r#""ab\ud83d"#, r#""ab\ud83d\"#] {
            assert_eq!(
                after_key(&format!(":{cut}")),
                AfterKey::Text {
                    text: "ab".into(),
                    end: None
                },
                "{cut}"
            );
        }
        assert_eq!(string_value(r#"{"mark"#, "\"markdown\""), "");
    }

    #[test]
    fn a_whole_string_ends_after_its_closing_quote() {
        let text = r#" : "a \ud83d\ude00\r\n b", "next""#;
        assert_eq!(
            after_key(text),
            AfterKey::Text {
                text: "a 😀\n b".into(),
                end: Some(text.find(',').unwrap())
            }
        );
        // Half a pair, or no character at all, is left out.
        assert_eq!(
            after_key(r#": "a\ud83d b\uZZZZ""#),
            AfterKey::Text {
                text: "a b".into(),
                end: Some(19)
            }
        );
    }

    #[test]
    fn what_isn_t_a_string_is_read_past_or_waited_for() {
        assert_eq!(after_key(": 700, "), AfterKey::Other { at: 2 });
        assert_eq!(after_key(" x"), AfterKey::Other { at: 1 });
        assert_eq!(after_key("  "), AfterKey::Pending);
        assert_eq!(after_key(" : "), AfterKey::Pending);
    }
}
