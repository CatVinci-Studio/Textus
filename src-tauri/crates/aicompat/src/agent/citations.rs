//! A step's sources: the markers that stand for them in its text until
//! they are numbered, and the spans of text each one backs.

use super::*;

pub(crate) const MARKER_OPEN: char = '\u{E000}';

pub(crate) const MARKER_CLOSE: char = '\u{E001}';

/// Where a step's text cites its `k`th (1-based) [`ProviderEvent::Citation`]:
/// the number between two private-use characters, which no model writes.
pub fn citation_marker(k: usize) -> String {
    format!("{MARKER_OPEN}{k}{MARKER_CLOSE}")
}

/// `text` with each [`citation_marker`] replaced by what `number` makes of
/// its index, or removed when it returns None.
pub fn replace_citation_markers(text: &str, number: impl Fn(usize) -> Option<String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(MARKER_OPEN) {
        out.push_str(&rest[..start]);
        let after = &rest[start + MARKER_OPEN.len_utf8()..];
        let Some(end) = after.find(MARKER_CLOSE) else {
            rest = after;
            continue;
        };
        if let Some(n) = after[..end].parse().ok().and_then(&number) {
            out.push_str(&n);
        }
        rest = &after[end + MARKER_CLOSE.len_utf8()..];
    }
    out.push_str(rest);
    out
}

/// One step's citations as a provider reads them: each page once, in the
/// order first cited, reported through the sink as it is found.
#[derive(Default)]
pub struct StepCitations {
    pub(crate) urls: Vec<String>,
}

impl StepCitations {
    /// The marker for `url`, reporting the page first if this step hasn't.
    pub fn cite(&mut self, url: &str, title: &str, on_event: EventSink<'_>) -> String {
        let k = match self.urls.iter().position(|u| u == url) {
            Some(i) => i + 1,
            None => {
                self.urls.push(url.to_string());
                on_event(ProviderEvent::Citation { url, title });
                self.urls.len()
            }
        };
        citation_marker(k)
    }
}

/// A span of a reply's text that cites a page: character (not byte)
/// offsets, end exclusive.
pub struct CitedSpan<'a> {
    pub start: usize,
    pub end: usize,
    pub url: &'a str,
    pub title: &'a str,
}

/// `text` with each cited span marked. A span that is the provider's inline
/// link for its citation gives way to the marker; plain prose keeps its words
/// and gets the marker after. A span that doesn't fit is cited at the end.
pub fn mark_cited_spans(
    text: &str,
    mut spans: Vec<CitedSpan<'_>>,
    citations: &mut StepCitations,
    on_event: EventSink<'_>,
) -> String {
    let chars: Vec<char> = text.chars().collect();
    spans.sort_by_key(|s| (s.start, s.end));
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    let mut trailing = String::new();
    for span in spans {
        let marker = citations.cite(span.url, span.title, on_event);
        if span.start < at || span.end > chars.len() || span.start > span.end {
            if !out.contains(&marker) && !trailing.contains(&marker) {
                trailing.push_str(&marker);
            }
            continue;
        }
        out.extend(&chars[at..span.start]);
        let cited: String = chars[span.start..span.end].iter().collect();
        if cited.contains("](") || cited.contains("http") {
            // "fact ([site](url))." reads "fact [1]." - the parentheses
            // around the link go with it, whether or not the span has them.
            let wrapped = out.ends_with('(') && chars.get(span.end) == Some(&')');
            if wrapped {
                out.pop();
            }
            out.push_str(&marker);
            at = span.end + usize::from(wrapped);
        } else {
            out.push_str(&cited);
            out.push_str(&marker);
            at = span.end;
        }
    }
    out.extend(&chars[at.min(chars.len())..]);
    out.push_str(&trailing);
    out
}
