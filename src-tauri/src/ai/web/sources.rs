//! The web pages a conversation has drawn on, numbered once for the whole
//! conversation: [3] in a later reply is the same page as in an earlier one.

use aicompat::agent::{replace_citation_markers, AgentTurn, Source};
use regex::Regex;
use std::sync::OnceLock;

/// Most sources listed under a reply that cites none by number (a provider
/// that searched without marking where).
const MAX_UNCITED_LISTED: usize = 8;

#[derive(Debug, Default)]
pub(crate) struct SourceBook {
    sources: Vec<Source>,
    /// How many came from earlier replies (the first ones).
    seeded: usize,
    /// The numbers the step in flight's native citations got, in the order
    /// the provider reported them.
    step: Vec<u32>,
}

/// One page, one number: a URL without its fragment or trailing slash.
fn same_page(url: &str) -> String {
    let url = url.trim();
    let url = url.split('#').next().unwrap_or(url);
    url.trim_end_matches('/').to_string()
}

pub(crate) fn host(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| {
            u.host_str()
                .map(|h| h.trim_start_matches("www.").to_string())
        })
        .unwrap_or_else(|| url.to_string())
}

/// `[n]` in a reply, the way the model is asked to cite.
fn number_pattern() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[(\d{1,3})\]").unwrap())
}

/// `[n](url)` in text proposed for the document.
fn link_pattern() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[(\d{1,3})\]\((https?://[^)\s]+)\)").unwrap())
}

impl SourceBook {
    /// The book as earlier replies in `history` left it.
    pub(crate) fn from_history(history: &[AgentTurn]) -> Self {
        let mut book = SourceBook::default();
        for turn in history {
            if let AgentTurn::Assistant { sources, .. } = turn {
                for source in sources {
                    if book.find(&source.url).is_none() && book.number_free(source.n) {
                        book.sources.push(source.clone());
                    }
                }
            }
        }
        book.seeded = book.sources.len();
        book
    }

    fn number_free(&self, n: u32) -> bool {
        !self.sources.iter().any(|s| s.n == n)
    }

    fn find(&self, url: &str) -> Option<&Source> {
        let page = same_page(url);
        self.sources.iter().find(|s| same_page(&s.url) == page)
    }

    /// The number of the page at `url`, given one if it has none yet.
    pub(crate) fn add(&mut self, url: &str, title: &str) -> u32 {
        let page = same_page(url);
        if let Some(source) = self.sources.iter_mut().find(|s| same_page(&s.url) == page) {
            if source.title.is_empty() && !title.trim().is_empty() {
                source.title = title.trim().to_string();
            }
            return source.n;
        }
        let n = self.sources.iter().map(|s| s.n).max().unwrap_or(0) + 1;
        self.sources.push(Source {
            n,
            url: url.trim().to_string(),
            title: title.trim().to_string(),
        });
        n
    }

    /// Whether some source has number `n`.
    pub(crate) fn has(&self, n: u32) -> bool {
        self.sources.iter().any(|s| s.n == n)
    }

    /// Every source, in number order.
    pub(crate) fn all(&self) -> Vec<Source> {
        let mut all = self.sources.clone();
        all.sort_by_key(|s| s.n);
        all
    }

    /// A page the provider's own search cited in the step in flight.
    pub(crate) fn cite_native(&mut self, url: &str, title: &str) {
        let n = self.add(url, title);
        self.step.push(n);
    }

    /// `text` with the step's citation markers as `[n]`; the step is done.
    pub(crate) fn resolve_step(&mut self, text: &str) -> String {
        let step = std::mem::take(&mut self.step);
        replace_citation_markers(text, |k| {
            step.get(k.checked_sub(1)?).map(|n| format!("[{n}]"))
        })
    }

    /// Ends a step whose text isn't kept (one that called tools).
    pub(crate) fn end_step(&mut self) {
        self.step.clear();
    }

    /// The sources to list under a reply: the ones `reply` cites as [n] and its
    /// proposals cite as [n](url), in number order. A reply that cites nothing by
    /// number lists what this exchange found instead.
    pub(crate) fn for_reply(&mut self, reply: &str, proposed: &[String]) -> Vec<Source> {
        let mut cited: Vec<u32> = number_pattern()
            .captures_iter(reply)
            .filter_map(|c| c[1].parse().ok())
            .collect();
        for text in proposed {
            for c in link_pattern().captures_iter(text) {
                let url = c[2].to_string();
                let n = self.add(&url, "");
                cited.push(n);
            }
        }
        let mut listed: Vec<Source> = if cited.is_empty() {
            self.sources[self.seeded..]
                .iter()
                .take(MAX_UNCITED_LISTED)
                .cloned()
                .collect()
        } else {
            self.sources
                .iter()
                .filter(|s| cited.contains(&s.n))
                .cloned()
                .collect()
        };
        for source in &mut listed {
            if source.title.is_empty() {
                source.title = host(&source.url);
            }
        }
        listed.sort_by_key(|s| s.n);
        listed
    }
}

/// History as the model is shown it: each reply followed by its sources, so
/// "is [2] reliable?" knows what is meant. Identical on every replay, for the
/// prompt cache.
pub(crate) fn with_sources_in_text(history: Vec<AgentTurn>) -> Vec<AgentTurn> {
    history
        .into_iter()
        .map(|turn| match turn {
            AgentTurn::Assistant { text, sources } if !sources.is_empty() => {
                let list = sources
                    .iter()
                    .map(|s| format!("[{}] {} - {}", s.n, s.title, s.url))
                    .collect::<Vec<_>>()
                    .join("\n");
                AgentTurn::Assistant {
                    text: format!("{text}\n\nSources:\n{list}"),
                    sources,
                }
            }
            turn => turn,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use aicompat::agent::citation_marker;

    fn source(n: u32, url: &str) -> Source {
        Source {
            n,
            url: url.into(),
            title: format!("Page {n}"),
        }
    }

    #[test]
    fn numbers_carry_on_from_earlier_replies_and_a_page_keeps_its_number() {
        let history = vec![AgentTurn::Assistant {
            text: "Tides turn twice a day [1][2].".into(),
            sources: vec![
                source(1, "https://a.example/"),
                source(2, "https://b.example/x"),
            ],
        }];
        let mut book = SourceBook::from_history(&history);
        assert_eq!(book.add("https://b.example/x#part", ""), 2);
        assert_eq!(book.add("https://c.example/", "C"), 3);
    }

    #[test]
    fn native_markers_become_the_numbers_their_pages_got() {
        let mut book = SourceBook::default();
        book.add("https://first.example/", "First");
        book.cite_native("https://second.example/", "Second");
        book.cite_native("https://first.example", "First");
        let text = format!(
            "Spring tides are highest{}{}.",
            citation_marker(1),
            citation_marker(2)
        );
        assert_eq!(book.resolve_step(&text), "Spring tides are highest[2][1].");
        // The step is over: a stray marker in the next one has no page.
        assert_eq!(book.resolve_step(&citation_marker(1)), "");
    }

    #[test]
    fn a_reply_lists_what_it_and_its_proposals_cite() {
        let mut book = SourceBook::from_history(&[AgentTurn::Assistant {
            text: String::new(),
            sources: vec![source(1, "https://old.example/")],
        }]);
        book.add("https://two.example/", "Two");
        book.add("https://three.example/", "Three");
        let listed = book.for_reply(
            "The tide tables agree [3].",
            &["Spring tides [9](https://www.new.example/p) peak.".to_string()],
        );
        let numbers: Vec<u32> = listed.iter().map(|s| s.n).collect();
        assert_eq!(numbers, vec![3, 4]);
        assert_eq!(listed[1].title, "new.example");
    }

    #[test]
    fn a_reply_that_cites_nothing_lists_this_exchanges_finds() {
        let mut book = SourceBook::from_history(&[AgentTurn::Assistant {
            text: String::new(),
            sources: vec![source(1, "https://old.example/")],
        }]);
        book.cite_native("https://new.example/", "New");
        let listed = book.for_reply("Searched and answered.", &[]);
        assert_eq!(
            listed,
            vec![Source {
                n: 2,
                url: "https://new.example/".into(),
                title: "New".into(),
            }]
        );
    }

    #[test]
    fn replayed_replies_carry_their_source_list() {
        let history = with_sources_in_text(vec![
            AgentTurn::Assistant {
                text: "Twice a day [1].".into(),
                sources: vec![source(1, "https://a.example/")],
            },
            AgentTurn::assistant("No sources."),
        ]);
        let AgentTurn::Assistant { text, .. } = &history[0] else {
            panic!()
        };
        assert_eq!(
            text,
            "Twice a day [1].\n\nSources:\n[1] Page 1 - https://a.example/"
        );
        assert!(matches!(&history[1], AgentTurn::Assistant { text, .. } if text == "No sources."));
    }
}
