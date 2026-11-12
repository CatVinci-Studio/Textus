//! delegate_task: a question's researcher hands a narrower part of its
//! question - a case, a data set, a dispute that needs searches of its own -
//! to a helper of its own. The helper keeps its notes with the question's,
//! spends the question's share of the budget, and hands nothing on; what it
//! kept comes back as the call's answer, so the researcher doesn't note it
//! again.

use super::model::clip;
use super::Note;
use aicompat::agent::ToolSpec;
use serde_json::{json, Value};

use super::tuning::MAX_HANDED;

pub(crate) const DELEGATE_TOOL: &str = "delegate_task";

/// What delegate_task looks like to the model.
pub(super) fn spec() -> ToolSpec {
    ToolSpec {
        name: DELEGATE_TOOL.into(),
        description: format!("Hand a narrower part of your question to a helper who researches it while you wait: a case, a data set, a dispute or a period that needs searches of its own. The helper keeps its notes with yours and spends your question's share of searches; its answer lists what it kept, so don't note that again. At most {MAX_HANDED} per question - use it for a part you can't cover in passing, not for your whole question.")
            .into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "The part to research, as one specific question"},
                "context": {"type": "string", "description": "What you already know that the helper shouldn't look for again, if anything"}
            },
            "required": ["question"]
        }),
    }
}

/// What a delegate_task call asks for.
#[derive(Debug, PartialEq)]
pub(super) struct Handed {
    pub question: String,
    pub context: Option<String>,
}

/// A delegate_task call's question, or why it can't be handed over.
/// `parent` is the researcher's own question, which isn't handed back.
pub(super) fn read(arguments: &str, parent: &str) -> Result<Handed, String> {
    let args: Value = serde_json::from_str(arguments).map_err(|e| e.to_string())?;
    let text = |key: &str| args[key].as_str().unwrap_or("").trim().to_string();
    let question = text("question");
    if question.is_empty() {
        return Err("Pass `question`: the part to research.".into());
    }
    if question.eq_ignore_ascii_case(parent.trim()) {
        return Err(
            "That's your whole question: hand over a narrower part of it, or research it yourself."
                .into(),
        );
    }
    let context = Some(text("context")).filter(|c| !c.is_empty());
    Ok(Handed { question, context })
}

/// The helper's first message: its question, and what is known already.
pub(super) fn brief(handed: &Handed) -> String {
    match &handed.context {
        Some(context) => format!(
            "Your question: {}\n\nKnown already - don't look for it again: {context}",
            handed.question
        ),
        None => format!("Your question: {}", handed.question),
    }
}

/// What the researcher is told the helper kept: its claims and their
/// sources' numbers, so they are cited as they are and not noted again.
pub(super) fn answer(question: &str, kept: &[Note]) -> String {
    if kept.is_empty() {
        return format!("The helper found nothing to keep on \"{question}\": cover it yourself if it matters, or leave it.");
    }
    let mut out = format!(
        "The helper kept {} note{} on \"{question}\" with yours - don't note these again:",
        kept.len(),
        if kept.len() == 1 { "" } else { "s" }
    );
    for note in kept {
        let sources: Vec<String> = note.sources.iter().map(|n| format!("[{n}]")).collect();
        out.push_str(&format!("\n- {} {}", clip(&note.claim), sources.join("")));
    }
    out
}
