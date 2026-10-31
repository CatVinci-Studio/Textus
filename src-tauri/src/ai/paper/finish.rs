//! What turns reviewed sections into a paper: a title and an abstract above
//! them, every figure numbered and captioned in reading order, and the list
//! of the sources the text cites below them, in the paper's language.

use super::draft::WEB_FIGURE_MARK;
use super::research::Model;
use super::{Dossier, Outline, Paper};
use aicompat::agent::{AgentTurn, StepResult};
use regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;

/// The words a paper's apparatus is labelled with, by the language it is
/// written in: abstract, references, figure.
fn words(language: &str) -> (&'static str, &'static str, &'static str) {
    let lang = language.to_lowercase();
    let traditional = ["zh-hant", "zh-tw", "zh-hk", "zh-mo"]
        .iter()
        .any(|t| lang.starts_with(t));
    match lang.split(['-', '_']).next().unwrap_or("") {
        "zh" if traditional => ("摘要", "參考文獻", "圖"),
        "zh" => ("摘要", "参考文献", "图"),
        "ja" => ("要旨", "参考文献", "図"),
        "ko" => ("초록", "참고문헌", "그림"),
        "es" => ("Resumen", "Referencias", "Figura"),
        "fr" => ("Résumé", "Références", "Figure"),
        "de" => ("Zusammenfassung", "Literatur", "Abbildung"),
        "ru" => ("Аннотация", "Литература", "Рисунок"),
        "pt" => ("Resumo", "Referências", "Figura"),
        _ => ("Abstract", "References", "Figure"),
    }
}

/// A figure's caption line: "图 3　…" in Chinese and Japanese, else
/// "Figure 3. …".
fn caption(language: &str, n: usize, text: &str) -> String {
    let (_, _, figure) = words(language);
    let cjk = ["zh", "ja"]
        .iter()
        .any(|l| language.to_lowercase().starts_with(l));
    let text = text.trim();
    match (cjk, text.is_empty()) {
        (_, true) => format!("*{figure} {n}*"),
        (true, false) => format!("*{figure} {n}　{text}*"),
        (false, false) => format!("*{figure} {n}. {text}*"),
    }
}

fn picture_line() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\s*!\[([^\]]*)\]\(textus-picture:").unwrap())
}

fn cited() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[(\d{1,3})\]\(https?://[^)\s]+\)").unwrap())
}

/// `sections` with a numbered caption under every figure, counted through
/// the whole paper: a diagram or chart block, a picture line, a web-picture
/// mark. A chart's caption or title, a picture's alt text and a mark's
/// description say what it shows. Returns how many there are.
pub(crate) fn number_figures(sections: &mut [String], language: &str) -> usize {
    let mut n = 0;
    for section in sections.iter_mut() {
        let mut out: Vec<String> = Vec::new();
        let mut fence: Option<(String, String)> = None;
        for line in section.lines() {
            out.push(line.to_string());
            let trimmed = line.trim_start();
            match fence.take() {
                None if trimmed.starts_with("```") => {
                    fence = Some((
                        trimmed.trim_start_matches('`').trim().to_lowercase(),
                        String::new(),
                    ));
                }
                None => {
                    let shows = if let Some(c) = picture_line().captures(line) {
                        Some(c[1].to_string())
                    } else {
                        trimmed
                            .strip_prefix(WEB_FIGURE_MARK)
                            .map(|rest| rest.trim_end_matches("-->").to_string())
                    };
                    if let Some(shows) = shows {
                        n += 1;
                        out.push(String::new());
                        out.push(caption(language, n, &shows));
                    }
                }
                Some((lang, _)) if trimmed.starts_with("```") => {
                    if lang == "mermaid" || lang == "chart" {
                        let spec: Value =
                            serde_json::from_str(&fence_body(&out)).unwrap_or_default();
                        let shows = spec["caption"]
                            .as_str()
                            .or(spec["title"].as_str())
                            .unwrap_or("");
                        n += 1;
                        out.push(String::new());
                        out.push(caption(language, n, shows));
                    }
                }
                Some((lang, mut body)) => {
                    body.push_str(line);
                    fence = Some((lang, body));
                }
            }
        }
        *section = out.join("\n");
    }
    n
}

/// The body of the fence `out` has just closed: its lines between the
/// opening and the closing fence.
fn fence_body(out: &[String]) -> String {
    let close = out.len() - 1;
    let open = out[..close]
        .iter()
        .rposition(|l| l.trim_start().starts_with("```"))
        .unwrap_or(close);
    out[open + 1..close].join("\n")
}

/// The sources `sections` cite, as the list that ends the paper: each by its
/// number, in number order, with its title and address. None when nothing is
/// cited.
pub(crate) fn references(sections: &[String], dossier: &Dossier, language: &str) -> Option<String> {
    let mut numbers: Vec<u32> = sections
        .iter()
        .flat_map(|s| {
            cited()
                .captures_iter(s)
                .filter_map(|c| c[1].parse().ok())
                .collect::<Vec<u32>>()
        })
        .collect();
    numbers.sort_unstable();
    numbers.dedup();
    let lines: Vec<String> = numbers
        .iter()
        .filter_map(|n| dossier.sources.iter().find(|s| s.n == *n))
        .map(|s| {
            let title = if s.title.trim().is_empty() {
                &s.url
            } else {
                &s.title
            };
            format!(
                "\\[{}\\] {}. <{}>",
                s.n,
                title.trim().trim_end_matches('.'),
                s.url
            )
        })
        .collect();
    if lines.is_empty() {
        return None;
    }
    let (_, heading, _) = words(language);
    Some(format!("## {heading}\n\n{}", lines.join("\n\n")))
}

/// The paper's title and abstract, from one tool-less step over the
/// finished sections; the topic as the title, and no abstract, when the
/// reply can't be read.
pub(crate) async fn opening(
    model: &dyn Model,
    paper: &Paper,
    outline: &Outline,
    sections: &[String],
) -> String {
    let (abstract_word, _, _) = words(&paper.language);
    let instructions = format!(
        "You write the title and the abstract of a finished paper, in the language tagged \"{}\". The title is specific and says what the paper finds or argues, not only its topic. The abstract, one paragraph of about 150-250 words (or 250-400 characters in Chinese or Japanese), states the question, the approach, the main findings with their key figures, and what follows from them - from the paper's text only, without citations. Reply with a JSON object {{\"title\": …, \"abstract\": …}} and nothing else.",
        paper.language
    );
    let message = format!("Thesis: {}\n\n{}", outline.thesis, sections.join("\n\n"));
    let reply = match model
        .step(
            &instructions,
            &[AgentTurn::User {
                text: message,
                images: Vec::new(),
            }],
            &[],
        )
        .await
    {
        Ok(StepResult::Done(text)) => text,
        _ => String::new(),
    };
    let parsed: Value = reply
        .find('{')
        .zip(reply.rfind('}'))
        .and_then(|(a, b)| serde_json::from_str(reply.get(a..=b)?).ok())
        .unwrap_or_default();
    let field = |key: &str| {
        parsed[key]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
    };
    let title = field("title").unwrap_or(paper.topic.trim());
    let cjk = ["zh", "ja", "ko"]
        .iter()
        .any(|l| paper.language.to_lowercase().starts_with(l));
    match field("abstract") {
        Some(text) if cjk => format!("# {title}\n\n**{abstract_word}**：{text}"),
        Some(text) => format!("# {title}\n\n**{abstract_word}:** {text}"),
        None => format!("# {title}"),
    }
}
