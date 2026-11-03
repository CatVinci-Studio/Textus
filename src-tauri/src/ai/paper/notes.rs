//! add_note, the one tool of its own a paper's researcher has: a finding
//! kept with the sources it rests on - web results by their numbers, local
//! files by their paths.

use super::research::{clip, is_search_page};
use super::sources::cited_file;
use super::{Lead, LeadKind, Note, PaperEvent};
use crate::ai::tools::{Access, Run, Tool, ToolContext};
use crate::ai::web::WebPlan;
use aicompat::agent::{ToolCall, ToolOutput, ToolSpec};
use serde_json::{json, Value};
use std::sync::Mutex;

pub(crate) const ADD_NOTE_TOOL: &str = "add_note";

/// What one question's add_note keeps its notes against, and where.
pub(super) struct NoteTaker<'a, 't> {
    pub question: &'a str,
    pub index: u32,
    pub web: &'a WebPlan,
    /// Where cited files are looked for: the project folder, and the paper's
    /// folder for `attached/...`.
    pub ctx: &'a ToolContext<'t>,
    pub notes: &'a Mutex<Vec<Note>>,
    pub send: &'a (dyn Fn(PaperEvent) + Sync),
}

impl<'a, 't> NoteTaker<'a, 't> {
    /// add_note, for a researcher's registry.
    pub(super) fn tool(&'a self) -> Tool<'a> {
        Tool {
            spec: spec(),
            access: Access::Proposes,
            modes: crate::ai::tools::EVERY_MODE,
            run: Run::Async(Box::new(move |call: ToolCall| {
                Box::pin(std::future::ready(self.keep(&call)))
            })),
        }
    }

    fn keep(&self, call: &ToolCall) -> ToolOutput {
        match read_note(&call.arguments, self.question, self.web, self.ctx) {
            Ok(note) => {
                (self.send)(PaperEvent::Activity {
                    question: self.index,
                    tool: ADD_NOTE_TOOL.to_string(),
                    arguments: json!({ "claim": clip(&note.claim) }).to_string(),
                });
                self.notes.lock().unwrap().push(note);
                "Kept.".to_string().into()
            }
            Err(why) => why.into(),
        }
    }
}

/// What add_note looks like to the model.
fn spec() -> ToolSpec {
    ToolSpec {
        name: ADD_NOTE_TOOL.into(),
        description: "Keep one finding for the paper: a claim, the evidence for it, and the sources it rests on. Call it once per finding as you go - several calls in one step are fine. Only what you keep with add_note reaches the paper; your replies don't.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "claim": {"type": "string", "description": "The finding, in one or two sentences"},
                "evidence": {"type": "string", "description": "What supports it: figures, results, examples, with their dates"},
                "quote": {"type": "string", "description": "Words taken verbatim from a source, if worth quoting"},
                "sources": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Each source's number from the search or page results (\"3\"), its full address when it has none, or a file's path as read_file reads it (attached/..., references/...)"
                },
                "leads": {
                    "type": "array",
                    "description": "Pictures or data in the sources a figure could use",
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string", "enum": ["image", "data"]},
                            "description": {"type": "string"},
                            "url": {"type": "string"}
                        },
                        "required": ["kind", "description"]
                    }
                }
            },
            "required": ["claim", "evidence", "sources"]
        }),
    }
}

/// An add_note call as a note, or why it can't be one. Its sources must be
/// numbers the web plan has, addresses (numbered here), or files that are
/// there.
fn read_note(
    arguments: &str,
    question: &str,
    web: &WebPlan,
    ctx: &ToolContext,
) -> Result<Note, String> {
    let args: Value = serde_json::from_str(arguments).map_err(|e| e.to_string())?;
    let text = |key: &str| args[key].as_str().unwrap_or("").trim().to_string();
    let (claim, evidence) = (text("claim"), text("evidence"));
    if claim.is_empty() || evidence.is_empty() {
        return Err("Pass `claim` and `evidence`.".into());
    }
    let cited: Vec<&str> = args["sources"]
        .as_array()
        .map(|list| list.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let mut sources = Vec::new();
    for c in &cited {
        let number = match cited_file(ctx, c) {
            Some((address, title)) => Some(web.add_source(&address, &title)),
            None => {
                let address = if c.trim().starts_with("http") {
                    Some(c.trim().to_string())
                } else {
                    c.trim_matches(['[', ']', ' '])
                        .parse()
                        .ok()
                        .and_then(|n| web.source_address(n))
                };
                if address.as_deref().is_some_and(is_search_page) {
                    return Err(format!("{c:?} is a search page, not a source: read the page or paper a result points to, and cite that."));
                }
                web.source_number(c)
            }
        };
        match number {
            Some(n) if !sources.contains(&n) => sources.push(n),
            Some(_) => {}
            None => return Err(format!("No source is numbered {c:?}: cite the number a search or page result has, the page's full address, or the path of a file you read.")),
        }
    }
    if sources.is_empty() {
        return Err("A note needs its sources: the numbers of the results it rests on. Search or read first.".into());
    }
    let leads = args["leads"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|l| {
            let kind = match l["kind"].as_str()? {
                "image" => LeadKind::Image,
                "data" => LeadKind::Data,
                _ => return None,
            };
            Some(Lead {
                kind,
                description: l["description"].as_str()?.trim().to_string(),
                url: l["url"].as_str().map(str::to_string),
            })
        })
        .collect();
    Ok(Note {
        id: String::new(),
        question: question.to_string(),
        claim,
        evidence,
        quote: Some(text("quote")).filter(|q| !q.is_empty()),
        sources,
        leads,
    })
}
