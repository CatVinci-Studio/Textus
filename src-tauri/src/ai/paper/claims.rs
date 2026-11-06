//! Every cited sentence checked against what its sources were found to say:
//! a section's sentences that cite are paired, by code, with the notes on
//! the sources they cite - each note's claim, evidence, quote and the
//! passage of the source it rests on - and a checker judges each pair. A
//! sentence its notes don't support becomes a point against its section,
//! revised with the review's.

use super::grounding::cited_sentences;
use super::handover::{hand_over, Checked, Task};
use super::research::Model;
use super::review::Issue;
use super::{checks::cited_link, Dossier, Grounding, Note, Paper};
use aicompat::agent::ToolSpec;
use futures_util::stream::{self, StreamExt};
use serde_json::{json, Value};

pub(crate) const REPORT_SUPPORT_TOOL: &str = "report_support";

/// Tries at a report that reads.
const CHECK_STEPS: usize = 3;
/// Sections checked at once.
const AT_ONCE: usize = 3;
/// The most sentences of a section checked: a section is a few hundred
/// words, so this is all of them but in a section gone wrong.
const MAX_SENTENCES: usize = 40;
/// The most notes shown for one source.
const NOTES_PER_SOURCE: usize = 4;
/// The most points kept against one section, the worst first.
const MAX_POINTS: usize = 3;

/// What a checker found of one sentence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Verdict {
    /// The notes say something else, or nothing about it.
    Unsupported,
    /// Another source the sentence lists says it, not the one cited for it.
    WrongSource,
    /// It says more, or more firmly, than its notes.
    Overstated,
    Supported,
}

impl Verdict {
    fn read(text: &str) -> Option<Self> {
        Some(match text {
            "unsupported" => Self::Unsupported,
            "wrong_source" => Self::WrongSource,
            "overstated" => Self::Overstated,
            "supported" => Self::Supported,
            _ => return None,
        })
    }

    fn says(self) -> &'static str {
        match self {
            Self::Unsupported => "isn't supported by its sources' notes",
            Self::WrongSource => "cites a source that doesn't say it",
            Self::Overstated => "says more than its sources' notes",
            Self::Supported => "is supported",
        }
    }
}

fn report_support_spec() -> ToolSpec {
    ToolSpec {
        name: REPORT_SUPPORT_TOOL.into(),
        description: "Report a verdict for every numbered sentence, once.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "verdicts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "sentence": {"type": "integer", "description": "The sentence's number, from 1"},
                            "verdict": {"type": "string", "enum": ["supported", "overstated", "unsupported", "wrong_source"]},
                            "why": {"type": "string", "description": "What the notes say instead, in one sentence; empty when supported"},
                            "fix": {"type": "string", "description": "How the sentence should read, or what to cut; empty when supported"}
                        },
                        "required": ["sentence", "verdict"]
                    }
                }
            },
            "required": ["verdicts"]
        }),
    }
}

/// One source's notes as the checker reads them.
fn source_notes(n: u32, notes: &[&Note]) -> String {
    let lines: Vec<String> = notes
        .iter()
        .filter(|note| note.sources.contains(&n))
        .take(NOTES_PER_SOURCE)
        .map(|note| {
            let mut line = format!("  - {} Evidence: {}", note.claim, note.evidence);
            if let Some(quote) = &note.quote {
                line.push_str(&format!(" Quote: \"{quote}\""));
            }
            if let Some(excerpt) = &note.excerpt {
                line.push_str(&format!(" The source says: \"{excerpt}\""));
            }
            if note.grounding == Grounding::Snippet {
                line.push_str(" (from a search snippet)");
            }
            line
        })
        .collect();
    if lines.is_empty() {
        format!("  [{n}] (no notes)")
    } else {
        format!("  [{n}]\n{}", lines.join("\n"))
    }
}

/// The checker's message for a section: each of its cited sentences,
/// numbered, with the notes on each source it cites. None when it cites
/// nothing, and the sentences it numbered.
fn message(section: &str, notes: &[&Note]) -> Option<(String, Vec<String>)> {
    let cited: Vec<(String, Vec<u32>)> = cited_sentences(section)
        .into_iter()
        .take(MAX_SENTENCES)
        .collect();
    if cited.is_empty() {
        return None;
    }
    let mut blocks = Vec::new();
    let mut sentences = Vec::new();
    for (i, (sentence, sources)) in cited.iter().enumerate() {
        let plain = cited_link().replace_all(sentence, "[$1]").into_owned();
        let notes: Vec<String> = sources.iter().map(|n| source_notes(*n, notes)).collect();
        blocks.push(format!(
            "<sentence number=\"{}\">\n{plain}\nIts sources' notes:\n{}\n</sentence>",
            i + 1,
            notes.join("\n")
        ));
        sentences.push(plain);
    }
    Some((blocks.join("\n\n"), sentences))
}

/// A report_support call as points against section `section`, the worst
/// first; or why it can't be read.
fn read_verdicts(
    arguments: &str,
    section: usize,
    sentences: &[String],
) -> Result<Vec<Issue>, String> {
    let args: Value = serde_json::from_str(arguments).map_err(|e| e.to_string())?;
    let list = args["verdicts"]
        .as_array()
        .ok_or("Pass `verdicts`, one for every numbered sentence.")?;
    let mut found: Vec<(Verdict, Issue)> = Vec::new();
    for item in list {
        let number = item["sentence"].as_u64().unwrap_or(0) as usize;
        let Some(sentence) = number.checked_sub(1).and_then(|i| sentences.get(i)) else {
            return Err(format!(
                "There is no sentence {number}: they are numbered 1 to {}.",
                sentences.len()
            ));
        };
        let verdict = Verdict::read(item["verdict"].as_str().unwrap_or(""))
            .ok_or("Each verdict is supported, overstated, unsupported or wrong_source.")?;
        if verdict == Verdict::Supported {
            continue;
        }
        let text = |key: &str| item[key].as_str().unwrap_or("").trim().to_string();
        let why = text("why");
        let fix = Some(text("fix"))
            .filter(|f| !f.is_empty())
            .unwrap_or_else(|| {
                "Say only what its notes say, citing the source that says it, or cut it.".into()
            });
        let problem = if why.is_empty() {
            format!("\"{sentence}\" {}.", verdict.says())
        } else {
            format!("\"{sentence}\" {}: {why}", verdict.says())
        };
        found.push((
            verdict,
            Issue {
                section,
                problem,
                fix,
            },
        ));
    }
    found.sort_by_key(|(verdict, _)| *verdict);
    Ok(found
        .into_iter()
        .take(MAX_POINTS)
        .map(|(_, issue)| issue)
        .collect())
}

/// Checks one section's cited sentences; no points when it cites nothing
/// or its checker reports nothing that reads.
async fn check_section(
    model: &dyn Model,
    instructions: &str,
    index: usize,
    section: &str,
    notes: &[&Note],
) -> Vec<Issue> {
    let Some((message, sentences)) = message(section, notes) else {
        return Vec::new();
    };
    let task = Task {
        instructions,
        message,
        tool: report_support_spec(),
        steps: CHECK_STEPS,
        watch: None,
    };
    let checked = hand_over(model, task, |arguments| {
        match read_verdicts(arguments, index, &sentences) {
            Ok(issues) => Checked::Kept(issues),
            Err(why) => Checked::Refused(format!("Not read: {why} Report again.")),
        }
    })
    .await;
    match checked {
        Ok((Some(issues), _)) => issues,
        _ => Vec::new(),
    }
}

/// The points against the drafted `sections` whose cited sentences their
/// sources' notes don't support, three sections at a time.
pub(crate) async fn check_claims(
    model: &dyn Model,
    paper: &Paper,
    dossier: &Dossier,
    sections: &[String],
) -> Vec<Issue> {
    let instructions = format!(
        "You check a drafted section of a {}, in the language tagged \"{}\", against the research notes it was written from, sentence by sentence. Each numbered sentence cites sources by [n]; under it are the notes on those sources - the researcher's claim and evidence, and where there is one the passage of the source itself, which outweighs the claim. For each sentence decide: supported - the notes say it (a paraphrase, a translation, a rounding are fine); overstated - it says more or more firmly than the notes (a cause for a correlation, all for some, a forecast as a fact, a range as one number, a figure or date changed); unsupported - the notes don't say it; wrong_source - a source it cites says it, but not the one cited at that point. Judge only by what the notes give, never by what you know. Report with report_support once, a verdict for every sentence, with what the notes say instead and how the sentence should read.",
        paper.genre.profile().name,
        paper.language
    );
    let notes: Vec<&Note> = dossier.notes.iter().collect();
    let (instructions, notes) = (&instructions, &notes);
    // By index, so the futures borrow only what this call holds: one that
    // borrowed the stream's items isn't Send for the command.
    let found: Vec<Vec<Issue>> = stream::iter(0..sections.len())
        .map(|i| check_section(model, instructions, i, &sections[i], notes))
        .buffered(AT_ONCE)
        .collect()
        .await;
    found.into_iter().flatten().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sections_cited_sentences_go_to_the_checker_with_their_notes() {
        let notes = [Note {
            claim: "Roofs were up to 30 °C cooler.".into(),
            evidence: "12 roofs.".into(),
            sources: vec![1],
            excerpt: Some("Measured on 12 roofs, up to 30 °C cooler.".into()),
            grounding: Grounding::Read,
            ..Default::default()
        }];
        let notes: Vec<&Note> = notes.iter().collect();
        let section = "Green roofs cool cities. They are always 30 °C cooler [1](https://a.example/1) [2](https://b.example/2).\n\n```chart\n{\"source\": \"[1](https://a.example/1)\"}\n```";
        let (text, sentences) = message(section, &notes).unwrap();
        assert_eq!(sentences, vec!["They are always 30 °C cooler [1] [2]."]);
        assert_eq!(
            text,
            "<sentence number=\"1\">\nThey are always 30 °C cooler [1] [2].\nIts sources' notes:\n  [1]\n  - Roofs were up to 30 °C cooler. Evidence: 12 roofs. The source says: \"Measured on 12 roofs, up to 30 °C cooler.\"\n  [2] (no notes)\n</sentence>"
        );
        assert!(message("Nothing cited.", &notes).is_none());
    }

    #[test]
    fn verdicts_become_points_the_worst_first() {
        let sentences: Vec<String> = ["A [1].", "B [2].", "C [1].", "D [3].", "E [1]."]
            .map(String::from)
            .to_vec();
        let args = json!({"verdicts": [
            {"sentence": 1, "verdict": "overstated", "why": "The notes say up to 30 °C.", "fix": "Say up to."},
            {"sentence": 2, "verdict": "supported"},
            {"sentence": 3, "verdict": "unsupported"},
            {"sentence": 4, "verdict": "wrong_source", "why": "[1] says it.", "fix": "Cite [1]."},
            {"sentence": 5, "verdict": "overstated"}
        ]});
        let issues = read_verdicts(&args.to_string(), 2, &sentences).unwrap();
        let problems: Vec<&str> = issues.iter().map(|i| i.problem.as_str()).collect();
        assert_eq!(
            problems,
            vec![
                "\"C [1].\" isn't supported by its sources' notes.",
                "\"D [3].\" cites a source that doesn't say it: [1] says it.",
                "\"A [1].\" says more than its sources' notes: The notes say up to 30 °C.",
            ]
        );
        assert!(issues.iter().all(|i| i.section == 2));
        assert_eq!(issues[2].fix, "Say up to.");
        assert!(issues[0].fix.starts_with("Say only what its notes say"));
        assert!(read_verdicts(
            r#"{"verdicts": [{"sentence": 9, "verdict": "supported"}]}"#,
            0,
            &sentences
        )
        .is_err());
        assert!(read_verdicts(
            r#"{"verdicts": [{"sentence": 1, "verdict": "maybe"}]}"#,
            0,
            &sentences
        )
        .is_err());
    }

    /// Reviews with nothing to report; checks sentences, faulting the first.
    struct Checker;

    impl Model for Checker {
        fn step<'a>(
            &'a self,
            _instructions: &'a str,
            turns: &'a [aicompat::agent::AgentTurn],
            tools: &'a [ToolSpec],
        ) -> futures_util::future::BoxFuture<'a, Result<aicompat::agent::StepResult, String>>
        {
            use aicompat::agent::{AgentTurn, StepResult};
            let args = if tools[0].name == REPORT_SUPPORT_TOOL {
                json!({"verdicts": [
                    {"sentence": 1, "verdict": "overstated", "why": "Up to 30 °C.", "fix": "Say up to."}
                ]})
            } else {
                json!({"issues": []})
            };
            let step = if turns.len() > 1 {
                StepResult::Done("Done.".into())
            } else {
                StepResult::ToolCalls(vec![AgentTurn::ToolCall {
                    call_id: "c".into(),
                    name: tools[0].name.to_string(),
                    arguments: args.to_string(),
                    reasoning: None,
                }])
            };
            Box::pin(async move { Ok(step) })
        }
    }

    #[tokio::test]
    async fn the_review_brings_the_checks_points_with_its_own() {
        use crate::ai::paper::{review, Outline};
        let paper = Paper {
            id: "abc".into(),
            topic: "Roofs".into(),
            genre: Default::default(),
            language: "en".into(),
            target_chars: 4000,
            budget: crate::ai::paper::ResearchBudget::for_paper(),
            stage: Default::default(),
        };
        let dossier = Dossier {
            notes: vec![Note {
                claim: "Roofs were up to 30 °C cooler.".into(),
                sources: vec![1],
                ..Default::default()
            }],
            sources: Vec::new(),
        };
        let sections = vec![
            "## A\n\nRoofs are always 30 °C cooler [1](https://a.example/1).".to_string(),
            "## B\n\nNothing cited here.".to_string(),
        ];
        let issues =
            review::review_all(&Checker, &paper, &Outline::default(), &dossier, &sections).await;
        assert_eq!(issues.len(), 1, "{issues:?}");
        assert_eq!(issues[0].section, 0);
        assert_eq!(
            issues[0].problem,
            "\"Roofs are always 30 °C cooler [1].\" says more than its sources' notes: Up to 30 °C."
        );
    }
}
