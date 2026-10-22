//! A vendor's own web search in a reply: what it found, and its
//! reference marks turned into numbered citations.

use super::*;

/// What a native web search said about the pages it used, gathered from a
/// response or its stream chunks - each provider puts it somewhere else.
#[derive(Default)]
pub(crate) struct SearchReport {
    /// OpenRouter: `url_citation` annotations on the message.
    pub(crate) annotations: Vec<Value>,
    /// Zhipu: a top-level `web_search` list, which the text cites as
    /// `[ref_1]` (or `[来源：ref_1]`) by each result's `refer`.
    pub(crate) zhipu_results: Vec<Value>,
    /// Groq: the browser_search calls the model made, with their results.
    pub(crate) executed_tools: Vec<Value>,
}

impl SearchReport {
    /// What `message` (a message, or a stream chunk's delta) and its
    /// `response` (or chunk) carry. A stream may repeat a list in several
    /// chunks; each entry is kept once.
    pub(crate) fn take(&mut self, message: &Value, response: &Value) {
        fn add(into: &mut Vec<Value>, list: Option<&Value>) {
            for v in list.and_then(|v| v.as_array()).into_iter().flatten() {
                if !into.contains(v) {
                    into.push(v.clone());
                }
            }
        }
        add(&mut self.annotations, message.get("annotations"));
        add(&mut self.executed_tools, message.get("executed_tools"));
        add(&mut self.zhipu_results, response.get("web_search"));
    }

    /// `text` with the pages it cites marked, every page reported.
    pub(crate) fn cite(&self, text: &str, on_event: EventSink<'_>) -> String {
        let mut citations = StepCitations::default();
        let spans: Vec<CitedSpan<'_>> = self
            .annotations
            .iter()
            .filter_map(|a| {
                let c = a.get("url_citation")?;
                let index = |key: &str| c.get(key).and_then(|v| v.as_u64()).map(|v| v as usize);
                Some(CitedSpan {
                    start: index("start_index")?,
                    end: index("end_index")?,
                    url: c.get("url")?.as_str()?,
                    title: c.get("title").and_then(|t| t.as_str()).unwrap_or(""),
                })
            })
            .collect();
        let mut text = if spans.is_empty() {
            text.to_string()
        } else {
            mark_cited_spans(text, spans, &mut citations, on_event)
        };
        if !self.zhipu_results.is_empty() {
            text = cite_zhipu_refs(&text, &self.zhipu_results, &mut citations, on_event);
        }
        if !self.executed_tools.is_empty() {
            // Groq's text points into its browser's pages as 【2†L6-L10】,
            // which name no page: the marks go, the pages are still listed.
            text = strip_between(&text, '【', '】', |inner| inner.contains('†'));
            for result in self.executed_tools.iter().flat_map(|t| {
                t.pointer("/search_results/results")
                    .and_then(|r| r.as_array())
                    .cloned()
                    .unwrap_or_default()
            }) {
                if let Some(url) = result.get("url").and_then(|u| u.as_str()) {
                    let title = result.get("title").and_then(|t| t.as_str()).unwrap_or("");
                    citations.cite(url, title, on_event);
                }
            }
        }
        text
    }
}

/// `text` without the `open`...`close` runs whose inside `drop` accepts.
pub(crate) fn strip_between(
    text: &str,
    open: char,
    close: char,
    drop: impl Fn(&str) -> bool,
) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(open) {
        let after = &rest[start + open.len_utf8()..];
        match after.find(close) {
            Some(end) if drop(&after[..end]) => {
                out.push_str(&rest[..start]);
                rest = &after[end + close.len_utf8()..];
            }
            _ => {
                out.push_str(&rest[..start + open.len_utf8()]);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Zhipu's `[ref_1]`, `[来源：ref_1]` or `【ref_1】` as citation markers, by
/// the `refer` of each result - or, when the text marks none, every result
/// with a link reported.
pub(crate) fn cite_zhipu_refs(
    text: &str,
    results: &[Value],
    citations: &mut StepCitations,
    on_event: EventSink<'_>,
) -> String {
    let page = |refer: &str| {
        results.iter().find_map(|r| {
            (r.get("refer").and_then(|v| v.as_str()) == Some(refer)).then(|| {
                (
                    r.get("link").and_then(|v| v.as_str()).unwrap_or(""),
                    r.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                )
            })
        })
    };
    let mut out = String::with_capacity(text.len());
    let mut matched = false;
    let mut rest = text;
    while let Some(start) = rest.find(['[', '【']) {
        out.push_str(&rest[..start]);
        let open = rest[start..].chars().next().unwrap();
        let close = if open == '[' { ']' } else { '】' };
        let after = &rest[start + open.len_utf8()..];
        let inner_end = after.find(close).filter(|&end| end <= 40);
        let refer = inner_end.and_then(|end| {
            let inner = &after[..end];
            let at = inner.find("ref_")?;
            let refer = &inner[at..];
            refer[4..]
                .chars()
                .all(|c| c.is_ascii_digit())
                .then_some(refer)
        });
        match (inner_end, refer.and_then(page)) {
            (Some(end), Some((url, title))) if !url.is_empty() => {
                out.push_str(&citations.cite(url, title, on_event));
                matched = true;
                rest = &after[end + close.len_utf8()..];
            }
            _ => {
                out.push(open);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    // A reply that searched but marked nothing still names its pages.
    if matched {
        return out;
    }
    for r in results {
        if let Some(url) = r
            .get("link")
            .and_then(|v| v.as_str())
            .filter(|u| !u.is_empty())
        {
            citations.cite(
                url,
                r.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                on_event,
            );
        }
    }
    out
}
