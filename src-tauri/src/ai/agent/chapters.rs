//! A long document changed the same way throughout (translated, put into
//! another register), with a helper per chapter working on all of them at once.
//! The helpers' proposals stream and enter history as the request's own.

use super::*;
use aicompat::agent::{ToolCall, ToolOutput, ToolSpec};
use futures_util::stream::{self, StreamExt};
use serde_json::{json, Value};
use std::sync::Mutex;

pub(crate) const EDIT_CHAPTERS_TOOL_NAME: &str = "edit_chapters";

/// Chapters worked on at once.
const AT_ONCE: usize = 4;
/// A helper's steps: its chapter's edits, a few blocks a call.
const CHAPTER_STEPS: usize = 8;
/// How long a document is, in char units, before a change through all of it
/// goes chapter by chapter.
const LONG_DOCUMENT: usize = 8_000;
/// At most this many chapters: more are joined, neighbours together.
const MAX_CHAPTERS: usize = 16;

/// One chapter: its blocks, first to last, and its heading's words.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Chapter {
    pub(crate) first: usize,
    pub(crate) last: usize,
    pub(crate) title: String,
}

/// A heading block's level, from its Markdown.
fn heading_level(markdown: &str) -> Option<usize> {
    let hashes = markdown.bytes().take_while(|&b| b == b'#').count();
    ((1..=6).contains(&hashes) && markdown[hashes..].starts_with(' ')).then_some(hashes)
}

/// The document's chapters: at the highest level of heading that comes
/// more than once (a lone title above them is the first chapter's), what
/// comes before the first going with it. Fewer than two: none.
pub(crate) fn chapters(document: &Document) -> Vec<Chapter> {
    let levels: Vec<Option<usize>> = document
        .blocks
        .iter()
        .map(|b| heading_level(document.block_text(b)))
        .collect();
    let Some(level) = (1..=6).find(|l| levels.iter().filter(|x| **x == Some(*l)).count() >= 2)
    else {
        return Vec::new();
    };
    let starts: Vec<usize> = (0..levels.len())
        .filter(|&i| levels[i] == Some(level))
        .collect();
    let mut chapters: Vec<Chapter> = starts
        .iter()
        .enumerate()
        .map(|(n, &start)| Chapter {
            first: if n == 0 { 0 } else { start },
            last: starts.get(n + 1).map_or(levels.len() - 1, |next| next - 1),
            title: document.block_text(&document.blocks[start])[level..]
                .trim()
                .to_string(),
        })
        .collect();
    // Too many: neighbours joined, the first's title kept.
    while chapters.len() > MAX_CHAPTERS {
        let mut joined = Vec::with_capacity(chapters.len().div_ceil(2));
        for pair in chapters.chunks(2) {
            joined.push(Chapter {
                first: pair[0].first,
                last: pair[pair.len() - 1].last,
                title: pair[0].title.clone(),
            });
        }
        chapters = joined;
    }
    chapters
}

/// Whether a request about `document` is offered edit_chapters: long, and
/// in chapters.
pub(crate) fn offers_chapters(document: &Document) -> bool {
    let size: usize = document
        .text
        .chars()
        .map(crate::ai::project::char_units)
        .sum();
    size >= LONG_DOCUMENT && chapters(document).len() >= 2
}

/// What the model is told about edit_chapters.
pub(crate) fn chapters_spec() -> ToolSpec {
    ToolSpec {
        name: EDIT_CHAPTERS_TOOL_NAME.into(),
        description: "This document is long and in chapters. For a change that goes the same way through all of it - a translation, a rewrite into another register or tense, the same correction everywhere - call this once instead of editing it yourself: every chapter is changed at once, each by a helper who sees only that chapter, the instruction and the glossary, and proposes its edits as you would. Write `instruction` as the whole change, in full, as the user asked it (the helpers don't see the conversation). In `glossary`, put the people, places and terms that recur and how each is to be written after the change, so every chapter writes them the same. Not for a change to one part, or one that needs the chapters to be read together (a summary, a reordering): do those yourself. Afterwards, tell the user in a sentence or two what was done; don't repeat the edits.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "instruction": {
                    "type": "string",
                    "description": "The change, in full, for every chapter."
                },
                "glossary": {
                    "type": "array",
                    "description": "Names and terms that recur, and how to write them.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "term": { "type": "string" },
                            "write": { "type": "string" }
                        },
                        "required": ["term", "write"]
                    }
                }
            },
            "required": ["instruction"]
        }),
    }
}

/// A helper's message: the change, the glossary, and that only this
/// chapter is theirs.
fn helper_message(
    instruction: &str,
    glossary: &[(String, String)],
    chapter: &Chapter,
    of: usize,
) -> String {
    let mut message = format!(
        "You are one of {of} helpers changing a long document at once, each one part of it. Your part is the chapter \"{}\", shown below - the whole of what you are to change. Change only its blocks; the other parts are other helpers'. Make the change with propose_edit as you would for any request, several consecutive blocks in one call where they change together, until the whole chapter is done; keep its pictures where they are. Then reply with one short line - the user doesn't see it.\n\nThe change, for the whole document:\n{instruction}",
        chapter.title
    );
    if !glossary.is_empty() {
        message.push_str("\n\nWrite these the same way as every other part does:\n");
        for (term, write) in glossary {
            message.push_str(&format!("- {term} → {write}\n"));
        }
    }
    message
}

/// The arguments' instruction and glossary, or why the call can't run.
fn read_call(arguments: &str) -> Result<(String, Vec<(String, String)>), String> {
    let args: Value = serde_json::from_str(arguments).map_err(|e| e.to_string())?;
    let instruction = args["instruction"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();
    if instruction.is_empty() {
        return Err("`instruction` is empty - write the change for every chapter.".into());
    }
    let glossary = args["glossary"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let term = item["term"].as_str()?.trim();
                    let write = item["write"].as_str()?.trim();
                    (!term.is_empty() && !write.is_empty())
                        .then(|| (term.to_string(), write.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();
    Ok((instruction, glossary))
}

/// The turns the helpers made, by the edit_chapters call they ran for,
/// to go into the request's history after its result.
pub(crate) type HelperTurns = Mutex<Vec<(String, Vec<AgentTurn>)>>;

/// `turns` with each edit_chapters call's helper turns after its result.
pub(crate) fn with_helper_turns(turns: Vec<AgentTurn>, helpers: &HelperTurns) -> Vec<AgentTurn> {
    let mut helpers = std::mem::take(&mut *helpers.lock().unwrap_or_else(|e| e.into_inner()));
    if helpers.is_empty() {
        return turns;
    }
    let mut out = Vec::with_capacity(turns.len());
    for turn in turns {
        let parent = match &turn {
            AgentTurn::ToolResult { call_id, .. } => Some(call_id.clone()),
            _ => None,
        };
        out.push(turn);
        if let Some(parent) = parent {
            if let Some(at) = helpers.iter().position(|(p, _)| *p == parent) {
                out.extend(helpers.remove(at).1);
            }
        }
    }
    out
}

/// What the request's run needs of its own for the helpers.
pub(crate) struct ChapterRun<'a, 'r> {
    pub(crate) agent: &'a aicompat::providers::AgentProvider,
    pub(crate) workspace: &'a AgentWorkspace,
    pub(crate) document: &'a Document,
    pub(crate) mode: AgentMode,
    pub(crate) ui_language: &'a str,
    pub(crate) conventions: &'a Conventions,
    /// propose_edit, the one tool a helper has.
    pub(crate) tools: &'a ToolRegistry<'r>,
    pub(crate) tool_ctx: &'a ToolContext<'r>,
    pub(crate) channel: &'a Channel<StreamEvent>,
    pub(crate) helpers: &'a HelperTurns,
}

impl ChapterRun<'_, '_> {
    /// One edit_chapters call: every chapter at once, AT_ONCE at a time;
    /// what came of each, for the model.
    pub(crate) async fn run(&self, call: ToolCall) -> ToolOutput {
        let (instruction, glossary) = match read_call(&call.arguments) {
            Ok(read) => read,
            Err(why) => return why.into(),
        };
        let chapters = chapters(self.document);
        let of = chapters.len();
        let results: Vec<(String, Result<Vec<AgentTurn>, String>)> = stream::iter(chapters)
            .map(|chapter| {
                let message = helper_message(&instruction, &glossary, &chapter, of);
                async move {
                    let turns = self.chapter(&chapter, message).await;
                    (chapter.title, turns)
                }
            })
            .buffered(AT_ONCE)
            .collect()
            .await;
        let mut lines = Vec::with_capacity(results.len());
        let mut made = Vec::new();
        for (title, result) in results {
            match result {
                Ok(turns) => {
                    let edits = turns
                        .iter()
                        .filter(|t| matches!(t, AgentTurn::ToolCall { name, .. } if name == crate::ai::tools::PROPOSE_EDIT_TOOL_NAME))
                        .count();
                    lines.push(format!("- \"{title}\": {edits} edits proposed"));
                    made.extend(turns);
                }
                Err(why) => lines.push(format!("- \"{title}\": not done - {why}")),
            }
        }
        self.helpers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push((call.call_id.clone(), made));
        format!(
            "The chapters were changed at once, each by a helper; their edits are proposed in the document, where the user accepts or rejects them:\n{}\nDon't propose these edits again. Tell the user in a sentence or two what was done, and about any chapter not done.",
            lines.join("\n")
        )
        .into()
    }

    /// One chapter's helper: the chapter as the document it sees. Returns its
    /// turns, without its message and its closing line.
    async fn chapter(&self, chapter: &Chapter, message: String) -> Result<Vec<AgentTurn>, String> {
        let part = Document::from_blocks(
            self.document.blocks[chapter.first..=chapter.last]
                .iter()
                .map(|b| doc_blocks::SentBlock {
                    id: b.id.clone(),
                    markdown: self.document.block_text(b).to_string(),
                    kind: b.kind.clone(),
                })
                .collect(),
        );
        let instructions = build_instructions(
            self.workspace,
            &part,
            true,
            self.mode,
            &message,
            self.ui_language,
        );
        let (context, _) = request_context_and_library(self.workspace, &part, true, &message, None);
        let user_turn = AgentTurn::User {
            text: request_message(
                self.workspace,
                self.mode,
                self.ui_language,
                &context,
                &message,
            ),
            images: Vec::new(),
        };
        let specs = self.tools.specs();
        let channel = self.channel;
        // Only its edits reach the window: its prose and thinking are for
        // the request's model, which says what was done.
        let sink = move |event: ProviderEvent<'_>| {
            let event = match event {
                ProviderEvent::ToolStart { call_id, name } => StreamEvent::ToolStart {
                    call_id: call_id.to_string(),
                    name: name.to_string(),
                },
                ProviderEvent::ToolArgs { call_id, delta } => StreamEvent::ToolArgsDelta {
                    call_id: call_id.to_string(),
                    delta: delta.to_string(),
                },
                _ => return,
            };
            let _ = channel.send(event);
        };
        let step = |turns: Vec<AgentTurn>| {
            let (instructions, specs, sink) = (&instructions, &specs, &sink);
            async move {
                let result = self.agent.step(instructions, &turns, specs, sink).await;
                result.map(|(step, _)| settle_step(step, self.document, self.conventions, None).0)
            }
        };
        let turns = run_agent_loop(
            Vec::new(),
            user_turn,
            CHAPTER_STEPS,
            step,
            |call| self.tools.execute(self.tool_ctx, call),
            |name| self.tools.how_to_run(name),
            |event| {
                // A helper's retry stays its own: the window's Retry would
                // drop every chapter's drafts.
                if let LoopEvent::Turn(turn) = event {
                    let _ = channel.send(StreamEvent::Turn {
                        turn: for_history(turn.clone()),
                    });
                }
            },
        )
        .await?;
        Ok(turns
            .into_iter()
            .filter(|t| matches!(t, AgentTurn::ToolCall { .. } | AgentTurn::ToolResult { .. }))
            .map(for_history)
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(text: &str) -> Document {
        Document::from_markdown(text)
    }

    #[test]
    fn a_document_is_in_chapters_at_its_highest_repeated_heading() {
        let d = doc("# The Book\n\nIntro.\n\n## One\n\nA.\n\n### Aside\n\nB.\n\n## Two\n\nC.");
        let found = chapters(&d);
        assert_eq!(found.len(), 2);
        // The title and intro go with the first chapter.
        assert_eq!(found[0].first, 0);
        assert_eq!(found[0].title, "One");
        assert_eq!(found[1].title, "Two");
        assert_eq!(found[1].last, d.blocks.len() - 1);
        assert_eq!(found[0].last + 1, found[1].first);
        // One heading, or none: no chapters.
        assert!(chapters(&doc("# Only\n\nText.")).is_empty());
        assert!(chapters(&doc("Text.\n\nMore.")).is_empty());
    }

    #[test]
    fn too_many_chapters_are_joined_in_pairs() {
        let text: String = (1..=40)
            .map(|n| format!("## C{n}\n\nText {n}.\n\n"))
            .collect();
        let found = chapters(&doc(&text));
        assert!(found.len() <= MAX_CHAPTERS);
        assert_eq!(found[0].title, "C1");
        assert_eq!(found.last().unwrap().last, doc(&text).blocks.len() - 1);
    }

    #[test]
    fn only_a_long_document_in_chapters_is_offered_it() {
        let short = doc("## One\n\nA.\n\n## Two\n\nB.");
        assert!(!offers_chapters(&short));
        let long: String = (1..=3)
            .map(|n| format!("## Chapter {n}\n\n{}\n\n", "Words here. ".repeat(300)))
            .collect();
        assert!(offers_chapters(&doc(&long)));
        assert!(!offers_chapters(&doc(&"Words here. ".repeat(1000))));
    }

    #[test]
    fn a_call_needs_an_instruction_and_keeps_a_clean_glossary() {
        assert!(read_call(r#"{"instruction": "  "}"#).is_err());
        let (instruction, glossary) = read_call(
            r#"{"instruction": "Translate into English.", "glossary": [{"term": "林远", "write": "Lin Yuan"}, {"term": "", "write": "x"}]}"#,
        )
        .unwrap();
        assert_eq!(instruction, "Translate into English.");
        assert_eq!(glossary, vec![("林远".to_string(), "Lin Yuan".to_string())]);
    }

    #[test]
    fn helper_turns_go_after_their_call_s_result() {
        let call = |id: &str| AgentTurn::ToolCall {
            call_id: id.into(),
            name: "x".into(),
            arguments: "{}".into(),
            reasoning: None,
        };
        let result = |id: &str| AgentTurn::ToolResult {
            call_id: id.into(),
            output: "ok".into(),
            images: Vec::new(),
        };
        let helpers: HelperTurns = Mutex::new(vec![("c1".into(), vec![call("h1"), result("h1")])]);
        let turns = with_helper_turns(
            vec![call("c1"), result("c1"), AgentTurn::assistant("Done.")],
            &helpers,
        );
        let ids: Vec<String> = turns
            .iter()
            .map(|t| match t {
                AgentTurn::ToolCall { call_id, .. } => format!("call {call_id}"),
                AgentTurn::ToolResult { call_id, .. } => format!("result {call_id}"),
                _ => "reply".into(),
            })
            .collect();
        assert_eq!(
            ids,
            ["call c1", "result c1", "call h1", "result h1", "reply"]
        );
    }
}
