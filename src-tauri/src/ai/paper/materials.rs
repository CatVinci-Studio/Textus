//! The files the user attached to a paper's request: kept beside the paper,
//! read by its research with read_material, and cited as `attached/<name>`.

use aicompat::agent::{ToolCall, ToolSpec};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct Material {
    /// The file's name, or its path in the project when picked with @.
    pub name: String,
    /// Its text, as the composer extracted it.
    pub content: String,
}

pub(crate) const READ_MATERIAL_TOOL: &str = "read_material";
/// How a material's address starts among the paper's sources.
const ATTACHED: &str = "attached/";
/// Characters one read_material call returns.
const WINDOW: usize = 8_000;

/// Material `name`'s address among the paper's sources.
pub(crate) fn material_address(name: &str) -> String {
    format!(
        "{ATTACHED}{}",
        percent_encoding::utf8_percent_encode(name, percent_encoding::NON_ALPHANUMERIC)
    )
}

/// The material's name at a source's address, or None for another source.
pub(crate) fn material_name(address: &str) -> Option<String> {
    address.strip_prefix(ATTACHED).map(|name| {
        percent_encoding::percent_decode_str(name)
            .decode_utf8_lossy()
            .into_owned()
    })
}

/// The material a note cites, by its name or its address.
pub(super) fn cited_material<'a>(materials: &'a [Material], cited: &str) -> Option<&'a Material> {
    let cited = cited.trim();
    let name = material_name(cited).unwrap_or_else(|| cited.to_string());
    materials.iter().find(|m| m.name == name)
}

/// What the helpers are told about the materials: their names and sizes.
pub(super) fn materials_prompt(materials: &[Material]) -> String {
    let list: Vec<String> = materials
        .iter()
        .map(|m| format!("{} ({} characters)", m.name, m.content.chars().count()))
        .collect();
    format!(
        " The user attached material of their own for this piece - {}: read what bears on your question with read_material before searching, and cite a file by its name in add_note's sources - it is the material the user chose.",
        list.join("; ")
    )
}

pub(super) fn material_spec() -> ToolSpec {
    ToolSpec {
        name: READ_MATERIAL_TOOL.into(),
        description: format!(
            "Read a file the user attached, {WINDOW} characters at a time from `start`."
        )
        .into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "start": {"type": "integer", "description": "The character to read from; 0 for the beginning"}
            },
            "required": ["name"]
        }),
    }
}

/// read_material's answer, or None for another tool.
pub(super) fn material_call(materials: &[Material], call: &ToolCall) -> Option<String> {
    if call.name != READ_MATERIAL_TOOL {
        return None;
    }
    let args: Value = serde_json::from_str(&call.arguments).unwrap_or_default();
    let name = args["name"].as_str().unwrap_or("");
    let Some(material) = cited_material(materials, name) else {
        let names: Vec<&str> = materials.iter().map(|m| m.name.as_str()).collect();
        return Some(format!(
            "No attached file is named {name:?}: pass one of {names:?}."
        ));
    };
    let start = args["start"].as_u64().unwrap_or(0) as usize;
    let total = material.content.chars().count();
    let text: String = material.content.chars().skip(start).take(WINDOW).collect();
    let end = (start + WINDOW).min(total);
    let more = if end < total {
        format!("\n(characters {start}-{end} of {total}; read on from {end})")
    } else {
        String::new()
    };
    Some(format!(
        "<external-content source=\"{}\">\n{text}\n</external-content>{more}",
        material.name
    ))
}

#[cfg(test)]
mod tests {
    use super::super::research::{self, ADD_NOTE_TOOL};
    use super::super::*;
    use super::*;
    use aicompat::agent::{AgentTurn, StepResult};
    use std::sync::Arc;

    /// Plans from the attached file, reads it, and cites it.
    struct Reader;

    impl research::Model for Reader {
        fn step<'a>(
            &'a self,
            instructions: &'a str,
            turns: &'a [AgentTurn],
            tools: &'a [ToolSpec],
        ) -> futures_util::future::BoxFuture<'a, Result<StepResult, String>> {
            let call = |id: &str, name: &str, args: Value| AgentTurn::ToolCall {
                call_id: id.into(),
                name: name.into(),
                arguments: args.to_string(),
                reasoning: None,
            };
            let step = if tools.is_empty() {
                let AgentTurn::User { text, .. } = &turns[0] else {
                    panic!("no topic");
                };
                assert!(text.contains("Tides were logged hourly."), "{text}");
                StepResult::Done(
                    r#"["What do the tide logs show?", "How often were the tides logged?"]"#.into(),
                )
            } else if turns.len() == 1 {
                assert!(instructions.contains("my notes.md"), "{instructions}");
                StepResult::ToolCalls(vec![call(
                    "r",
                    READ_MATERIAL_TOOL,
                    json!({"name": "my notes.md"}),
                )])
            } else if turns.len() == 3 {
                let AgentTurn::ToolResult { output, .. } = &turns[2] else {
                    panic!("no result");
                };
                assert!(output.contains("Tides were logged hourly."), "{output}");
                StepResult::ToolCalls(vec![call(
                    "n",
                    ADD_NOTE_TOOL,
                    json!({"claim": "Tides were logged hourly.", "evidence": "The logs.", "sources": ["my notes.md"]}),
                )])
            } else {
                StepResult::Done("Covered.".into())
            };
            Box::pin(async move { Ok(step) })
        }
    }

    #[tokio::test]
    async fn the_research_reads_and_cites_the_files_attached() {
        let budget = Arc::new(SharedBudget::new(ResearchBudget::for_paper()));
        let web = crate::ai::web::WebPlan::new(true, None, None, &[]).with_budget(budget.clone());
        let paper = Paper {
            id: "abc123".into(),
            topic: "Tides".into(),
            genre: Genre::Report,
            language: "en".into(),
            target_chars: 4000,
            budget: ResearchBudget::for_paper(),
            stage: PaperStage::Researching,
        };
        let materials = [Material {
            name: "my notes.md".into(),
            content: "Tides were logged hourly.".into(),
        }];
        let dossier = research::research(&Reader, &paper, &web, &budget, &|_| {}, None, &materials)
            .await
            .unwrap();
        assert_eq!(dossier.notes.len(), 2);
        assert_eq!(dossier.sources.len(), 1);
        assert_eq!(dossier.sources[0].url, "attached/my%20notes%2Emd");
        assert_eq!(
            super::super::finish::entry(&dossier.sources[0]),
            "`my notes.md`"
        );
    }

    #[test]
    fn the_files_attached_are_kept_for_a_run_that_goes_on() {
        let root = tempfile::tempdir().unwrap();
        let materials = vec![Material {
            name: "a.md".into(),
            content: "A".into(),
        }];
        assert!(store::load_materials(root.path(), "abc123")
            .unwrap()
            .is_empty());
        store::save_materials(root.path(), "abc123", &materials).unwrap();
        assert_eq!(
            store::load_materials(root.path(), "abc123").unwrap(),
            materials
        );
    }
}
