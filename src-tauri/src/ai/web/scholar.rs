//! search_papers: scholarly works from OpenAlex (journals, conferences, books,
//! by way of Crossref and others) and arXiv (preprints), both public and
//! keyless. A paper is cited like a page: by its DOI, else its landing page.

use super::search::http_client;
use crate::extract::xml::{Node, Pull};
use serde_json::Value;

pub(crate) const SEARCH_PAPERS_TOOL: &str = "search_papers";

/// Works asked of each index per query.
const PER_INDEX: usize = 6;
/// An abstract is cut here in the results: enough to judge the paper by.
const ABSTRACT_CHARS: usize = 600;

/// One scholarly work, as either index describes it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Paper {
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<u32>,
    pub venue: Option<String>,
    pub doi: Option<String>,
    /// The DOI's address, else the index's own page for the work.
    pub url: String,
    pub abstract_text: String,
    pub cited_by: Option<u64>,
}

impl Paper {
    /// "Lovelace, Babbage et al. (1843)": who and when, as a reader cites it.
    pub(crate) fn byline(&self) -> String {
        let who = match self.authors.as_slice() {
            [] => String::new(),
            [one] => one.clone(),
            [one, two] => format!("{one}, {two}"),
            [one, two, ..] => format!("{one}, {two} et al."),
        };
        match self.year {
            Some(year) if who.is_empty() => format!("({year})"),
            Some(year) => format!("{who} ({year})"),
            None => who,
        }
    }

    /// The paper as a numbered result for the model.
    pub(crate) fn describe(&self, n: u32) -> String {
        let mut about = vec![self.url.clone()];
        about.extend(self.venue.clone());
        if let Some(cited) = self.cited_by {
            about.push(format!("cited by {cited}"));
        }
        let summary: String = self
            .abstract_text
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let summary = if summary.chars().count() > ABSTRACT_CHARS {
            format!(
                "{}…",
                summary.chars().take(ABSTRACT_CHARS).collect::<String>()
            )
        } else {
            summary
        };
        format!(
            "[{n}] {}\n{}\n{}\n{summary}",
            self.title,
            self.byline(),
            about.join(" · ")
        )
    }
}

/// Both indexes searched for `query` at once, merged: OpenAlex's first (it
/// ranks by relevance and citations), then arXiv's that it doesn't have.
/// Fails only when both do.
pub(crate) async fn search(query: &str, since: Option<u32>) -> Result<Vec<Paper>, String> {
    let (openalex, arxiv) = tokio::join!(openalex(query, since), arxiv(query));
    let (mut papers, more) = match (openalex, arxiv) {
        (Err(a), Err(b)) => return Err(format!("{a}; {b}")),
        (a, b) => (a.unwrap_or_default(), b.unwrap_or_default()),
    };
    for paper in more {
        if since.is_some_and(|y| paper.year.is_some_and(|p| p < y)) {
            continue;
        }
        if !papers.iter().any(|p| same_work(p, &paper)) {
            papers.push(paper);
        }
    }
    Ok(papers)
}

/// The same work in both indexes: one DOI, or one title.
fn same_work(a: &Paper, b: &Paper) -> bool {
    let key = |p: &Paper| -> String {
        p.title
            .chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect()
    };
    matches!((&a.doi, &b.doi), (Some(x), Some(y)) if x.eq_ignore_ascii_case(y)) || key(a) == key(b)
}

async fn openalex(query: &str, since: Option<u32>) -> Result<Vec<Paper>, String> {
    let mut params = vec![
        ("search", query.to_string()),
        ("per-page", PER_INDEX.to_string()),
        (
            "select",
            "id,doi,title,publication_year,authorships,primary_location,abstract_inverted_index,cited_by_count".into(),
        ),
    ];
    if let Some(year) = since {
        params.push(("filter", format!("from_publication_date:{year}-01-01")));
    }
    let response = http_client()?
        .get("https://api.openalex.org/works")
        .query(&params)
        .send()
        .await
        .map_err(|e| format!("OpenAlex couldn't be reached: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("OpenAlex answered {}", response.status()));
    }
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(openalex_papers(&body))
}

/// OpenAlex's `results`, as papers.
pub(super) fn openalex_papers(body: &Value) -> Vec<Paper> {
    let works = body.get("results").and_then(Value::as_array);
    works
        .into_iter()
        .flatten()
        .filter_map(|work| {
            let title = work.get("title")?.as_str()?.trim().to_string();
            let doi = work
                .get("doi")
                .and_then(Value::as_str)
                .map(|d| d.trim_start_matches("https://doi.org/").to_string());
            let url = doi
                .as_ref()
                .map(|d| format!("https://doi.org/{d}"))
                .or_else(|| work.get("id")?.as_str().map(str::to_string))?;
            let authors = work
                .get("authorships")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|a| {
                    a.pointer("/author/display_name")?
                        .as_str()
                        .map(str::to_string)
                })
                .collect();
            Some(Paper {
                title,
                authors,
                year: work
                    .get("publication_year")
                    .and_then(Value::as_u64)
                    .map(|y| y as u32),
                venue: work
                    .pointer("/primary_location/source/display_name")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                doi,
                url,
                abstract_text: work
                    .get("abstract_inverted_index")
                    .map(uninvert)
                    .unwrap_or_default(),
                cited_by: work.get("cited_by_count").and_then(Value::as_u64),
            })
        })
        .collect()
}

/// OpenAlex keeps an abstract as word -> positions: the words in order.
fn uninvert(index: &Value) -> String {
    let Some(words) = index.as_object() else {
        return String::new();
    };
    let mut placed: Vec<(u64, &str)> = words
        .iter()
        .flat_map(|(word, at)| {
            at.as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_u64)
                .map(move |n| (n, word.as_str()))
        })
        .collect();
    placed.sort_unstable_by_key(|(n, _)| *n);
    placed.iter().map(|(_, w)| *w).collect::<Vec<_>>().join(" ")
}

async fn arxiv(query: &str) -> Result<Vec<Paper>, String> {
    let response = http_client()?
        .get("https://export.arxiv.org/api/query")
        .query(&[
            ("search_query", arxiv_query(query)),
            ("max_results", PER_INDEX.to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("arXiv couldn't be reached: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("arXiv answered {}", response.status()));
    }
    let body = response.bytes().await.map_err(|e| e.to_string())?;
    Ok(arxiv_papers(&body))
}

/// arXiv reads a space between words as OR: every word required instead.
pub(super) fn arxiv_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|word| format!("all:{word}"))
        .collect::<Vec<_>>()
        .join(" AND ")
}

/// arXiv's Atom feed, as papers.
pub(super) fn arxiv_papers(atom: &[u8]) -> Vec<Paper> {
    let mut pull = Pull::new(atom);
    let mut papers = Vec::new();
    loop {
        match pull.next() {
            Node::Open(tag) if tag.name == "entry" => papers.push(arxiv_entry(&mut pull)),
            Node::End => break,
            _ => {}
        }
    }
    papers
        .into_iter()
        .filter(|p| !p.title.is_empty() && !p.url.is_empty())
        .collect()
}

/// One `<entry>`, read through its close.
fn arxiv_entry(pull: &mut Pull) -> Paper {
    let mut paper = Paper {
        title: String::new(),
        authors: Vec::new(),
        year: None,
        venue: Some("arXiv".into()),
        doi: None,
        url: String::new(),
        abstract_text: String::new(),
        cited_by: None,
    };
    let squash = |s: String| s.split_whitespace().collect::<Vec<_>>().join(" ");
    loop {
        match pull.next() {
            Node::Open(tag) => match tag.name.as_str() {
                "title" => paper.title = squash(pull.text()),
                "summary" => paper.abstract_text = squash(pull.text()),
                "id" => paper.url = pull.text().trim().replace("http://", "https://"),
                "published" => paper.year = pull.text().get(..4).and_then(|y| y.parse().ok()),
                "doi" => paper.doi = Some(pull.text().trim().to_string()),
                // <author><name>…</name></author>
                "author" => {
                    let name = squash(pull.text());
                    if !name.is_empty() {
                        paper.authors.push(name);
                    }
                }
                _ => pull.skip(),
            },
            Node::Close | Node::End => return paper,
            Node::Text(_) => {}
        }
    }
}
