//! Gemini's OpenAI-compatible layer, asked for its thoughts
//! (`include_thoughts`), writes them into the reply's text between
//! `<thought>` and `</thought>` - in one chunk or across several. Split out
//! here, they go where every other provider's reasoning goes.

const OPEN: &str = "<thought>";
const CLOSE: &str = "</thought>";

/// Splits a reply's text, chunk by chunk, into thought and answer. A chunk
/// ending in what may be the start of a tag holds that back for the next.
#[derive(Default)]
pub(crate) struct ThoughtTags {
    inside: bool,
    held: String,
    /// Just past a `</thought>`: the answer's leading line break is the
    /// tag's, not the answer's.
    after_close: bool,
}

impl ThoughtTags {
    /// This chunk's (thought, answer).
    pub(crate) fn split(&mut self, chunk: &str) -> (String, String) {
        let mut rest = std::mem::take(&mut self.held) + chunk;
        let (mut thought, mut answer) = (String::new(), String::new());
        loop {
            let tag = if self.inside { CLOSE } else { OPEN };
            let Some(at) = rest.find(tag) else {
                // The longest tail that could still become the tag.
                let held = (1..tag.len())
                    .rev()
                    .find(|&n| rest.ends_with(&tag[..n]))
                    .unwrap_or(0);
                self.held = rest.split_off(rest.len() - held);
                self.take(&rest, &mut thought, &mut answer);
                return (thought, answer);
            };
            self.take(&rest[..at], &mut thought, &mut answer);
            self.after_close = self.inside;
            self.inside = !self.inside;
            rest = rest[at + tag.len()..].to_string();
        }
    }

    /// The end of the reply: what was held back is text after all.
    pub(crate) fn finish(&mut self) -> (String, String) {
        let held = std::mem::take(&mut self.held);
        let (mut thought, mut answer) = (String::new(), String::new());
        self.take(&held, &mut thought, &mut answer);
        (thought, answer)
    }

    fn take(&mut self, text: &str, thought: &mut String, answer: &mut String) {
        if self.inside {
            thought.push_str(text);
            return;
        }
        let text = if self.after_close {
            let trimmed = text.trim_start_matches(['\n', '\r']);
            if !text.is_empty() {
                self.after_close = trimmed.is_empty();
            }
            trimmed
        } else {
            text
        };
        answer.push_str(text);
    }
}

/// A whole reply's text, split at once (a reply that didn't stream).
pub(crate) fn split_whole(text: &str) -> (String, String) {
    let mut tags = ThoughtTags::default();
    let (mut thought, mut answer) = tags.split(text);
    let (t, a) = tags.finish();
    thought.push_str(&t);
    answer.push_str(&a);
    (thought, answer)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(chunks: &[&str]) -> (String, String) {
        let mut tags = ThoughtTags::default();
        let (mut thought, mut answer) = (String::new(), String::new());
        for chunk in chunks {
            let (t, a) = tags.split(chunk);
            thought += &t;
            answer += &a;
        }
        let (t, a) = tags.finish();
        (thought + &t, answer + &a)
    }

    #[test]
    fn a_thought_in_one_chunk_and_the_answer_after_it() {
        assert_eq!(
            run(&["<thought>Weigh both.</thought>\n\nThe second."]),
            ("Weigh both.".into(), "The second.".into())
        );
    }

    #[test]
    fn tags_cut_across_chunks() {
        assert_eq!(
            run(&[
                "<tho",
                "ught>Weigh",
                " both.</th",
                "ought>",
                "\nThe ",
                "second."
            ]),
            ("Weigh both.".into(), "The second.".into())
        );
    }

    #[test]
    fn text_without_tags_is_all_answer() {
        assert_eq!(
            run(&["a < b", " and <tho"]),
            ("".into(), "a < b and <tho".into())
        );
        assert_eq!(
            split_whole("Plain.\n\nTwo lines."),
            ("".into(), "Plain.\n\nTwo lines.".into())
        );
    }

    #[test]
    fn a_whole_reply_splits_the_same() {
        assert_eq!(
            split_whole("<thought>One.</thought>Two."),
            ("One.".into(), "Two.".into())
        );
    }
}
