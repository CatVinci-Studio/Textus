//! What a drafted section must hold - its length, its citations, its
//! figures and their data - and the checks that send it back to its writer
//! when it doesn't.

use super::{FigureKind, OutlineSection};
use regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;

use super::tuning::{PASS, SOFT};

/// The most a section of `target` may run to, as writers are told.
pub(crate) fn most(target: u32) -> u32 {
    (target as f64 * PASS.1).round() as u32
}

/// Whether two addresses are one, written with or without percent-escapes
/// ("(" or "%28") or a trailing slash.
pub(super) fn same_address(a: &str, b: &str) -> bool {
    let plain = |s: &str| {
        percent_encoding::percent_decode_str(s.trim_end_matches('/'))
            .decode_utf8_lossy()
            .into_owned()
    };
    a == b || plain(a) == plain(b)
}

/// Where a web picture goes until one is found for it.
pub(crate) const WEB_FIGURE_MARK: &str = "<!-- textus-figure web:";

/// A citation as the paper writes it, `[n](address)`: a web page's address,
/// or a local file's path (`attached/…`, `references/…`).
pub(crate) fn cited_link() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[(\d{1,3})\]\((https?://[^)\s]+|[^)\s:#/][^)\s:]*)\)").unwrap())
}

/// A figure named by a number, "图 2" or "Figure 2": the writers' own
/// numbers, which the paper's numbering would contradict.
pub(super) fn numbered_figure() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?:图|圖|図|Figure|Fig\.|Abbildung|Figura|Рисунок|그림)\s*\d+").unwrap()
    })
}

/// `[n]` not followed by `(`: a citation without its link.
pub(super) fn bare_number() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[(\d{1,3})\]($|[^(\d])").unwrap())
}

/// `markdown`'s fenced blocks, as (language, body).
pub(super) fn fences(markdown: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut open: Option<(String, String)> = None;
    for line in markdown.lines() {
        let trimmed = line.trim_start();
        match open.take() {
            None if trimmed.starts_with("```") => {
                open = Some((
                    trimmed.trim_start_matches('`').trim().to_lowercase(),
                    String::new(),
                ));
            }
            None => {}
            Some(block) if trimmed.starts_with("```") => out.push(block),
            Some((lang, mut body)) => {
                body.push_str(line);
                body.push('\n');
                open = Some((lang, body));
            }
        }
    }
    out
}

/// The section's prose, without its fences, pictures and marks: what its
/// length counts.
pub(super) fn prose(markdown: &str) -> String {
    let mut out = String::new();
    let mut in_fence = false;
    for line in markdown.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence || trimmed.starts_with("![") || trimmed.starts_with("<!--") {
            continue;
        }
        out.push_str(&cited_link().replace_all(line, ""));
        out.push('\n');
    }
    out
}

/// `text`'s length: its characters (not spaces) for a language written
/// without spaces, else its words.
pub(crate) fn length(text: &str, language: &str) -> u32 {
    if ["zh", "ja", "ko"].iter().any(|l| language.starts_with(l)) {
        text.chars().filter(|c| !c.is_whitespace()).count() as u32
    } else {
        text.split_whitespace().count() as u32
    }
}

/// The length of `markdown`'s prose: its text without code, figures,
/// marks or citations' addresses - what a paper's length is measured by.
#[cfg(test)]
pub(crate) fn prose_length(markdown: &str, language: &str) -> u32 {
    length(&prose(markdown), language)
}

/// The most series and points a series the chart renderer draws
/// (`MAX_SERIES` and `MAX_POINTS` in `src/editor/chart/chart-spec.ts`).
const MOST_SERIES: usize = 8;
const MOST_POINTS: usize = 1000;

/// Whether a chart block's JSON is one the chart renderer draws: it refuses
/// all `parseChartSpec` (`src/editor/chart/chart-spec.ts`) refuses, which
/// `src/editor/chart/chart-cases.json` holds both to. A chart that passed
/// here but not there reached a paper as its JSON source.
pub(super) fn chart_holds(body: &str) -> Result<(), String> {
    let spec: Value =
        serde_json::from_str(body).map_err(|e| format!("its JSON doesn't parse ({e})"))?;
    if !spec.is_object() {
        return Err("it must be one JSON object".into());
    }
    let kind = match &spec["type"] {
        Value::Null => "bar",
        kind => kind.as_str().unwrap_or("?"),
    };
    if !["bar", "line", "area", "pie", "scatter"].contains(&kind) {
        return Err(format!(
            "\"type\" {} isn't bar, line, area, pie or scatter",
            spec["type"]
        ));
    }
    let series = spec["series"]
        .as_array()
        .filter(|s| !s.is_empty())
        .ok_or("it needs a non-empty \"series\"")?;
    if series.len() > MOST_SERIES {
        return Err(format!("at most {MOST_SERIES} series"));
    }
    let number = |v: &Value| v.as_f64().is_some_and(f64::is_finite);
    for (i, s) in series.iter().enumerate() {
        let n = i + 1;
        let data = s["data"]
            .as_array()
            .filter(|d| !d.is_empty())
            .ok_or("every series needs a non-empty \"data\" list")?;
        if data.len() > MOST_POINTS {
            return Err(format!("at most {MOST_POINTS} points a series"));
        }
        if kind == "scatter" {
            let pair = |p: &Value| {
                p.as_array()
                    .is_some_and(|p| p.len() == 2 && p.iter().all(number))
            };
            if !data.iter().all(pair) {
                return Err(format!("series {n}: \"data\" must be [x, y] number pairs"));
            }
        } else if !data.iter().all(number) {
            return Err(format!(
                "series {n}: \"data\" must be plain numbers - no units, percent signs, quotes or nulls"
            ));
        }
        if !s["name"].is_null() && !s["name"].is_string() {
            return Err(format!("series {n}: \"name\" must be text"));
        }
        if kind == "pie" && i == 0 && data.iter().any(|v| v.as_f64() < Some(0.0)) {
            return Err("a pie's values can't be negative".into());
        }
    }
    if spec["x"].is_array() {
        return Err("\"x\" is the x axis' title, one text; the categories go in \"labels\"".into());
    }
    for key in ["title", "x", "y", "caption", "source"] {
        if !spec[key].is_null() && !spec[key].is_string() {
            return Err(format!("\"{key}\" must be text"));
        }
    }
    let points = series
        .iter()
        .filter_map(|s| s["data"].as_array().map(Vec::len))
        .max()
        .unwrap_or(0);
    match &spec["labels"] {
        Value::Null => {}
        Value::Array(labels) if kind != "scatter" && labels.len() < points => {
            return Err(format!(
                "{} \"labels\" for {points} data points: one label each",
                labels.len()
            ));
        }
        Value::Array(_) => {}
        _ => return Err("\"labels\" must be a list".into()),
    }
    if spec["source"]
        .as_str()
        .is_some_and(|s| note_id().is_match(s))
    {
        return Err("\"source\" names notes by their ids; name the sources by their numbers, as [3](address)".into());
    }
    Ok(())
}

/// A note's id, as the dossier numbers them ("n12"): for the reader, the
/// sources are what is cited, never the notes.
pub(super) fn note_id() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?:^|[^A-Za-z0-9])n\d+(?:$|[^A-Za-z0-9])").unwrap())
}

/// What is wrong with `markdown` as section `section` of `paper`, all at once.
/// One thing wrong with a drafted section, as its writer is told it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Problem {
    pub text: String,
    /// Whether a section with only soft problems is kept rather than lose
    /// the paper: its length off its target, a planned figure missing, a
    /// post too long. A wrong citation or a chart that can't be drawn is
    /// never kept.
    pub soft: bool,
}

impl Problem {
    pub(crate) fn hard(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            soft: false,
        }
    }

    pub(crate) fn soft(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            soft: true,
        }
    }
}

/// So a list of problems joins as text, as the writer is sent it.
impl std::borrow::Borrow<str> for Problem {
    fn borrow(&self) -> &str {
        &self.text
    }
}

/// Whether every problem in `wrong` is soft (none at all is too).
pub(crate) fn all_soft(wrong: &[Problem]) -> bool {
    wrong.iter().all(|p| p.soft)
}

/// What is wrong with a drafted section, every problem at once.
/// `sources`: the numbers this section may cite, with their addresses.
pub(crate) fn problems(
    markdown: &str,
    section: &OutlineSection,
    sources: &[(u32, String)],
    language: &str,
) -> Vec<Problem> {
    let mut out = Vec::new();
    let length = length(&prose(markdown), language);
    let target = section.target_words as f64;
    let ratio = length as f64 / target.max(1.0);
    let most = most(section.target_words);
    if ratio > SOFT.1 {
        out.push(Problem::hard(format!(
            "Far too long: {length} against about {} - cut it to at most {most}, keeping the strongest evidence.",
            section.target_words
        )));
    } else if ratio < SOFT.0 {
        out.push(Problem::hard(format!(
            "Far too short: {length} against about {} - develop the key points with the notes' evidence.",
            section.target_words
        )));
    } else if ratio < PASS.0 || ratio > PASS.1 {
        out.push(Problem::soft(format!(
            "It is {length} long; the section is to be about {} (at most {most}).",
            section.target_words
        )));
    }
    let mut cited = 0;
    for c in cited_link().captures_iter(markdown) {
        let n: u32 = c[1].parse().unwrap_or(0);
        match sources.iter().find(|(m, _)| *m == n) {
            Some((_, url)) if same_address(url, &c[2]) => cited += 1,
            Some((_, url)) => out.push(Problem::hard(format!(
                "[{n}] links to {} but source {n} is {url}.",
                &c[2]
            ))),
            None => out.push(Problem::hard(format!(
                "[{n}] isn't one of this section's sources."
            ))),
        }
    }
    if bare_number().is_match(&prose(markdown)) {
        out.push(Problem::hard(
            "A citation is written as [n] alone: write it [n](address), with the source's address.",
        ));
    }
    if let Some(found) = numbered_figure().find(&prose(markdown)) {
        out.push(Problem::hard(format!(
            "\"{}\" names a figure by a number: the figures are numbered afterwards - call it the diagram, chart or picture below or above.",
            found.as_str()
        )));
    }
    if cited == 0 && !sources.is_empty() {
        out.push(Problem::hard(
            "Nothing is cited: mark each fact from the notes with its source, [n](address).",
        ));
    }
    let blocks = fences(markdown);
    let count = |kind: FigureKind| section.figures.iter().filter(|f| f.kind == kind).count();
    let mermaid = blocks
        .iter()
        .filter(|(lang, body)| lang == "mermaid" && !body.trim().is_empty())
        .count();
    if mermaid < count(FigureKind::Mermaid) {
        out.push(Problem::soft(format!(
            "{} planned diagram(s), {mermaid} ```mermaid block(s).",
            count(FigureKind::Mermaid)
        )));
    }
    let charts: Vec<&String> = blocks
        .iter()
        .filter(|(lang, _)| lang == "chart")
        .map(|(_, body)| body)
        .collect();
    for (i, body) in charts.iter().enumerate() {
        if let Err(why) = chart_holds(body) {
            out.push(Problem::hard(format!("Chart {}: {why}.", i + 1)));
        }
    }
    if charts.len() < count(FigureKind::Chart) {
        out.push(Problem::soft(format!(
            "{} planned chart(s), {} ```chart block(s).",
            count(FigureKind::Chart),
            charts.len()
        )));
    }
    let pictures = markdown.matches("](textus-picture:").count();
    if pictures < count(FigureKind::Generated) {
        out.push(Problem::soft(format!(
            "{} planned picture(s), {pictures} textus-picture line(s).",
            count(FigureKind::Generated)
        )));
    }
    let web = markdown.matches(WEB_FIGURE_MARK).count();
    if web < count(FigureKind::Web) {
        out.push(Problem::soft(format!(
            "{} planned web picture(s), {web} mark(s).",
            count(FigureKind::Web)
        )));
    }
    out
}

#[cfg(test)]
mod chart_tests {
    use super::chart_holds;
    use serde_json::Value;

    #[test]
    fn a_chart_passes_only_if_the_renderer_would_draw_it() {
        let cases: Value = serde_json::from_str(include_str!(
            "../../../../src/editor/chart/chart-cases.json"
        ))
        .unwrap();
        for case in cases["cases"].as_array().unwrap() {
            let spec = case["spec"].to_string();
            let draws = case["draws"].as_bool().unwrap();
            assert_eq!(
                chart_holds(&spec).is_ok(),
                draws,
                "{spec}: {:?}",
                chart_holds(&spec)
            );
        }
    }

    #[test]
    fn a_series_past_the_renderer_s_points_is_refused() {
        let data: Vec<u32> = (0..1001).collect();
        let spec = serde_json::json!({ "series": [{ "data": data }] }).to_string();
        assert!(chart_holds(&spec).unwrap_err().contains("at most 1000"));
    }
}
