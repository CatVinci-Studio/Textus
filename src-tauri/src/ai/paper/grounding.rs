//! Whether a note says what its sources said: its quote found in their words,
//! its figures among theirs, and the passage it rests on kept beside it. The
//! words are what the sources showed the researcher (`WebPlan::seen`); a
//! source never shown (one the provider's own search cited, an address a
//! plugin gave) can't be checked, and isn't.

use super::checks::{cited_link, Problem};
use super::Note;
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

/// The most of a source's words kept beside a note.
const EXCERPT_CHARS: usize = 400;
/// The least a passage must share with a note to be its excerpt: a figure
/// counts for FIGURE_WEIGHT, a pair of letters or characters for one.
const EXCERPT_MIN_SCORE: usize = 12;
const FIGURE_WEIGHT: usize = 8;

/// `text` as letters and digits only, lowercased: what a quote is compared
/// by, so spacing, punctuation and quote marks don't matter.
fn plain(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// Whether `quote` is in `words`, spacing and punctuation aside.
pub(super) fn has_quote(words: &str, quote: &str) -> bool {
    let quote = plain(quote);
    quote.is_empty() || plain(words).contains(&quote)
}

/// A number as written: "1,200" with its thousands, "3.5", "2024".
fn number() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?").unwrap())
}

/// A citation, `[3]`, whose number is no figure.
fn citation() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[\d{1,3}\](?:\([^)\s]*\))?").unwrap())
}

/// The figures `text` gives, each as one form - "1,200" and "1200" alike,
/// "3.50" as "3.5" - leaving out whole numbers under ten, which are written
/// as words as often as not.
pub(super) fn figures(text: &str) -> Vec<String> {
    let text = citation().replace_all(text, " ");
    let mut out: Vec<String> = Vec::new();
    for m in number().find_iter(&text) {
        let mut figure = m.as_str().replace(',', "");
        if figure.contains('.') {
            figure = figure
                .trim_end_matches('0')
                .trim_end_matches('.')
                .to_string();
        }
        let small = !figure.contains('.') && figure.parse::<u64>().is_ok_and(|n| n < 10);
        if !small && !out.contains(&figure) {
            out.push(figure);
        }
    }
    out
}

/// The figures of `text` that none of `words` gives.
pub(super) fn missing_figures(text: &str, words: &[&str]) -> Vec<String> {
    let given: HashSet<String> = words.iter().flat_map(|w| figures(w)).collect();
    figures(text)
        .into_iter()
        .filter(|f| !given.contains(f))
        .collect()
}

/// `text`'s neighbouring pairs of letters or characters.
fn pairs(text: &str) -> HashSet<(char, char)> {
    let chars: Vec<char> = plain(text).chars().collect();
    chars.windows(2).map(|w| (w[0], w[1])).collect()
}

/// `text`'s sentences and lines, trimmed: a sentence ends at a full stop,
/// question or exclamation mark followed by a space or the end - so "3.5"
/// stays whole - or at one of the CJK marks, which need none.
pub(super) fn sentences(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        let next_is_space = chars.peek().is_none_or(|(_, n)| n.is_whitespace());
        let ends = matches!(c, '。' | '！' | '？' | '\n')
            || (matches!(c, '.' | '!' | '?') && next_is_space);
        if ends {
            let end = i + c.len_utf8();
            out.push(text[start..end].trim());
            start = end;
        }
    }
    out.push(text[start..].trim());
    out.retain(|s| !s.is_empty());
    out
}

/// The passage of `words` a note saying `said` most likely rests on - the
/// sentence sharing most of its figures and wording, with the next one when
/// it is short - or None when no passage shares enough.
pub(super) fn excerpt(words: &str, said: &str) -> Option<String> {
    let wanted_pairs = pairs(said);
    let wanted_figures = figures(said);
    let list = sentences(words);
    let score = |p: &str| {
        let figures = figures(p)
            .iter()
            .filter(|f| wanted_figures.contains(f))
            .count();
        let shared = pairs(p).intersection(&wanted_pairs).count();
        figures * FIGURE_WEIGHT + shared
    };
    let (best, top) = list
        .iter()
        .enumerate()
        .map(|(i, p)| (i, score(p)))
        .max_by_key(|&(i, s)| (s, std::cmp::Reverse(i)))?;
    if top < EXCERPT_MIN_SCORE {
        return None;
    }
    let mut text = list[best].to_string();
    if text.chars().count() < EXCERPT_CHARS / 2 {
        if let Some(next) = list.get(best + 1) {
            text.push(' ');
            text.push_str(next);
        }
    }
    Some(clip(&text))
}

/// What starts a section's problem with a figure its sources don't give -
/// a soft problem, as its length is.
const UNSUPPORTED_FIGURE: &str = "A figure its sources don't give";
/// The most such problems told at once.
const MAX_UNSUPPORTED: usize = 5;

/// The figures each source's notes give - their claims, evidence, quotes
/// and excerpts, less the figures their sources were found not to give.
pub(super) fn figures_by_source<'a>(
    notes: impl IntoIterator<Item = &'a Note>,
) -> HashMap<u32, HashSet<String>> {
    let mut out: HashMap<u32, HashSet<String>> = HashMap::new();
    for note in notes {
        let said = format!(
            "{} {} {} {}",
            note.claim,
            note.evidence,
            note.quote.as_deref().unwrap_or(""),
            note.excerpt.as_deref().unwrap_or("")
        );
        let given: Vec<String> = figures(&said)
            .into_iter()
            .filter(|f| !note.unmatched.contains(f))
            .collect();
        for n in &note.sources {
            out.entry(*n).or_default().extend(given.iter().cloned());
        }
    }
    out
}

/// A section's cited sentences that give a figure none of the sources they
/// cite gave in their notes, as problems for its writer. Code, pictures and
/// marks aside; a sentence that cites nothing isn't read.
pub(super) fn unsupported_figures(
    markdown: &str,
    given: &HashMap<u32, HashSet<String>>,
) -> Vec<Problem> {
    let mut text = String::new();
    let mut in_fence = false;
    for line in markdown.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
        } else if !(in_fence || trimmed.starts_with("![") || trimmed.starts_with("<!--")) {
            text.push_str(line);
            text.push('\n');
        }
    }
    let empty = HashSet::new();
    let mut out = Vec::new();
    for sentence in sentences(&text) {
        let cited: Vec<u32> = cited_link()
            .captures_iter(sentence)
            .filter_map(|c| c[1].parse().ok())
            .collect();
        if cited.is_empty() {
            continue;
        }
        let missing: Vec<String> = figures(sentence)
            .into_iter()
            .filter(|f| {
                !cited
                    .iter()
                    .any(|n| given.get(n).unwrap_or(&empty).contains(f))
            })
            .collect();
        if missing.is_empty() {
            continue;
        }
        let plain = cited_link().replace_all(sentence, "");
        let cites: String = cited.iter().map(|n| format!("[{n}]")).collect();
        out.push(Problem::soft(format!(
            "{UNSUPPORTED_FIGURE}: \"{}\" has {} but the notes of {cites} don't - give the figure as the notes do, cite the source that gives it, or leave it out.",
            clip_to(plain.trim(), 120),
            missing.join(", ")
        )));
        if out.len() == MAX_UNSUPPORTED {
            break;
        }
    }
    out
}

fn clip(text: &str) -> String {
    clip_to(text, EXCERPT_CHARS)
}

fn clip_to(text: &str, most: usize) -> String {
    if text.chars().count() <= most {
        return text.to_string();
    }
    let cut: String = text.chars().take(most).collect();
    format!("{}…", cut.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_quote_is_found_whatever_its_spacing_and_punctuation() {
        let page = "Roofs were “up to 30 °C cooler” at noon. 绿色屋顶 能 降温。";
        assert!(has_quote(page, "up to 30 °C cooler"));
        assert!(has_quote(page, "\"Up to 30°C cooler\""));
        assert!(has_quote(page, "绿色屋顶能降温"));
        assert!(!has_quote(page, "up to 40 °C cooler"));
        assert!(has_quote(page, " … "));
    }

    #[test]
    fn figures_are_compared_in_one_form() {
        assert_eq!(
            figures("1,200 roofs, 3.50 m, 7 cities, 1200 again, 2024 [12](https://x.example/12)"),
            vec!["1200", "3.5", "2024"]
        );
        assert_eq!(figures("增长 30% 至 45.0 亿"), vec!["30", "45"]);
        assert_eq!(
            missing_figures(
                "Cooler by 30 °C on 12 roofs in 2019.",
                &["12 roofs", "30 °C"]
            ),
            vec!["2019"]
        );
    }

    #[test]
    fn sentences_end_at_their_marks_but_not_inside_a_number() {
        assert_eq!(
            sentences("Up 3.5 m. Why? 涨了。再涨\nNext"),
            vec!["Up 3.5 m.", "Why?", "涨了。", "再涨", "Next"]
        );
    }

    #[test]
    fn a_cited_sentence_gives_only_its_sources_figures() {
        let notes = [
            Note {
                claim: "Roofs were 30 °C cooler.".into(),
                evidence: "12 roofs, since 2019.".into(),
                sources: vec![1],
                unmatched: vec!["2019".into()],
                ..Default::default()
            },
            Note {
                claim: "It cost 4.5 million.".into(),
                sources: vec![2],
                ..Default::default()
            },
        ];
        let given = figures_by_source(&notes);
        let section = "Roofs were 30 °C cooler on 12 roofs [1](https://a.example/1). They cost 4.5 million [1](https://a.example/1). Since 2019 [1](https://a.example/1), and 40 more uncited.\n\n```chart\n{\"data\": [77]}\n```";
        let found = unsupported_figures(section, &given);
        assert_eq!(found.len(), 2, "{found:?}");
        assert_eq!(
            found[0].text,
            "A figure its sources don't give: \"They cost 4.5 million .\" has 4.5 but the notes of [1] don't - give the figure as the notes do, cite the source that gives it, or leave it out."
        );
        assert!(found[1].text.contains("has 2019"), "{}", found[1].text);
        // Sent back, but kept on a writer's last try, as a length is.
        assert!(found[0].soft);
    }

    #[test]
    fn the_excerpt_is_the_sentence_the_note_rests_on() {
        let page = "Green roofs are common in Europe. Measured on 12 roofs, surfaces were up to 30 °C cooler than tar. Costs vary widely by city and by the plants chosen for them.";
        assert_eq!(
            excerpt(page, "Green roofs lower surface temperature by up to 30 °C, on 12 roofs.").as_deref(),
            Some("Measured on 12 roofs, surfaces were up to 30 °C cooler than tar. Costs vary widely by city and by the plants chosen for them.")
        );
        assert_eq!(excerpt(page, "Pandas eat bamboo."), None);
    }
}
