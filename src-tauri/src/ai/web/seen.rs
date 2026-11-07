//! What a source said when it was shown to the model - a page's text, a
//! search result's snippet, a paper's abstract - kept by the source's number,
//! so a note taken from it can be checked against its words. Kept only where
//! asked for (a paper's research), and only as long as its `WebPlan`.

use std::collections::HashMap;

/// Most characters kept for one source: a page read in full is cut at
/// fetch::MAX_PAGE_CHARS already; snippets from many searches add up.
const MAX_CHARS: usize = 40_000;

/// How much of a source the model saw.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Reach {
    /// A search result's snippet or a paper's abstract.
    Snippet,
    /// The page itself, read with web_fetch.
    Read,
}

/// One source's words, as shown.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Seen {
    pub text: String,
    pub reach: Reach,
}

#[derive(Debug, Default)]
pub(crate) struct SeenText {
    by_source: HashMap<u32, Seen>,
}

impl SeenText {
    /// Keeps `text` as shown for source `n`: added to what it had, unless it
    /// had it already; a page read makes the source `Read`.
    pub(crate) fn record(&mut self, n: u32, text: &str, reach: Reach) {
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        let seen = self.by_source.entry(n).or_insert(Seen {
            text: String::new(),
            reach,
        });
        if reach == Reach::Read {
            seen.reach = Reach::Read;
        }
        if seen.text.contains(text) || seen.text.chars().count() >= MAX_CHARS {
            return;
        }
        if !seen.text.is_empty() {
            seen.text.push_str("\n\n");
        }
        let room = MAX_CHARS.saturating_sub(seen.text.chars().count());
        seen.text.extend(text.chars().take(room));
    }

    pub(crate) fn get(&self, n: u32) -> Option<&Seen> {
        self.by_source.get(&n)
    }
}

impl super::State {
    /// Keeps what source `n`, titled `title`, said, if the plan keeps it.
    pub(super) fn saw(&mut self, n: u32, title: &str, text: &str, reach: Reach) {
        if let Some(seen) = &mut self.seen {
            seen.record(n, &format!("{title}\n{text}"), reach);
        }
    }

    /// The number of the page at `url`, read in full: what it said kept.
    pub(super) fn read(&mut self, url: &str, title: &str, text: &str) -> u32 {
        let n = self.book.add(url, title);
        self.saw(n, title, text, Reach::Read);
        n
    }
}

impl super::WebPlan {
    /// Keeps what each source said when shown, for `seen`: a paper's
    /// Whether a source has the page at `address` already: one a search
    /// showed, a page read, or one the provider's own search cited.
    pub(crate) fn knows(&self, address: &str) -> bool {
        self.state.lock().unwrap().book.find(address).is_some()
    }

    /// research checks its notes against it. Off for chat, which never asks.
    pub(crate) fn keeping_seen_text(self) -> Self {
        self.state.lock().unwrap().seen = Some(Default::default());
        self
    }

    /// What source `n` said when shown, if this plan keeps it and it was
    /// shown: a page's text, or its search snippets and abstract.
    pub(crate) fn seen(&self, n: u32) -> Option<Seen> {
        self.state.lock().unwrap().seen.as_ref()?.get(n).cloned()
    }

    /// Keeps `text` as what source `n` said - a file of the user's, read
    /// elsewhere.
    pub(crate) fn saw(&self, n: u32, text: &str, reach: Reach) {
        self.state.lock().unwrap().saw(n, "", text, reach);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snippets_add_up_once_and_a_read_page_makes_the_source_read() {
        let mut seen = SeenText::default();
        seen.record(3, "Tides turn twice a day.", Reach::Snippet);
        seen.record(3, "Tides turn twice a day.", Reach::Snippet);
        assert_eq!(seen.get(3).unwrap().reach, Reach::Snippet);
        seen.record(
            3,
            "The full page: spring tides peak at new moon.",
            Reach::Read,
        );
        let three = seen.get(3).unwrap();
        assert_eq!(three.reach, Reach::Read);
        assert_eq!(
            three.text,
            "Tides turn twice a day.\n\nThe full page: spring tides peak at new moon."
        );
        seen.record(4, "  ", Reach::Read);
        assert!(seen.get(4).is_none());
    }

    #[test]
    fn a_source_keeps_at_most_its_share() {
        let mut seen = SeenText::default();
        seen.record(1, &"a".repeat(MAX_CHARS - 10), Reach::Read);
        seen.record(1, &"b".repeat(100), Reach::Snippet);
        let one = seen.get(1).unwrap();
        assert_eq!(one.text.chars().count(), MAX_CHARS);
        seen.record(1, "more", Reach::Snippet);
        assert_eq!(seen.get(1).unwrap().text.chars().count(), MAX_CHARS);
    }
}
