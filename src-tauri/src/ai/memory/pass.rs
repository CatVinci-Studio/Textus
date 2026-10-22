//! What is remembered is decided after each exchange, apart from it (the
//! way mem0 keeps a chat's memory): one small request sees the user's
//! messages, the reply and what is already remembered, and answers with
//! the changes - add, update, forget - which go through the same writer
//! as before (MemoryDirs::remember), so duplicates, facts joining their
//! entry and the user's own library entries are handled as they were.
//!
//! In the main request, a remember tool depended on the model thinking of
//! it while it edited: GPT kept 23 of 24 things over several
//! conversations, DeepSeek 20 (it hardly ever called it), and models said
//! "from now on I will" without keeping anything (1.2.0-rc.6,
//! live_eval::memory_sessions).

use super::*;

/// How much of each message and of the reply the pass is shown: what is
/// worth remembering is said in a sentence, not in a pasted chapter.
const CLIP_CHARS: usize = 1_500;

/// The user's messages shown, newest last: enough for a correction to be
/// read with what it corrects.
const RECENT_MESSAGES: usize = 6;

/// What the pass is told - the same for every provider.
const PASS_INSTRUCTIONS: &str = r#"You keep the memory of Textus AI, a writing assistant: what should still hold in the user's later conversations. You are shown the newest exchange of a conversation - the user's messages (the last one is new) and the assistant's reply - and what is already remembered. Answer with the changes to make, as JSON only.

What to keep:
- requirement: something the user wants always or never done ("from now on", "always", "never", a rule of their style guide or house style).
- preference: what they like or dislike in replies and edits - said outright, or in a correction that states a general taste ("too flowery, I like it plain"), or in the same correction asked again.
- style: a trait of how they write.
- fact: about their work - a person, place or term and what is true of it, with its name and other names it goes by - even told in passing as background to a request ("Lin is the heroine, a lighthouse keeper - write the next scene").
What not to keep: a request about this text only ("make this more formal", "shorter", "add a line about X"), what the document already says, the assistant's own suggestions, anything private (phone numbers, addresses, health, money, passwords). When in doubt, keep nothing: most exchanges change nothing.

Where it goes (scope): personal - about the user, for everything they write (how to reply to them, their habits and tastes); project - about this work (its people and terms, its spelling, voice, tense, audience, format). "I don't like…", "reply to me in…", "from now on…" are personal unless they name the work; "in this book…", "our product…", "our style guide…" are project. A fact is always the project's. Without a project folder, keep only what is personal - nothing about this work.

Against what is remembered: what is already there needs nothing. A change to or correction of a memory updates it (its id). When the user takes one back ("forget…", "X is fine again"), forget it (its id). A fact about someone or something already in the library uses that entry's name.

Write each memory as one or a few plain sentences, in the language the user writes to you in, as an instruction to the assistant ("Reply in English.", "Use 你, never 您, in internal documents.").

Answer with exactly this JSON and nothing else:
{"changes": [{"op": "add" | "update" | "forget", "id": "<the id, for update and forget>", "kind": "requirement" | "preference" | "style" | "fact", "scope": "personal" | "project", "name": "<for a fact>", "aliases": ["<for a fact>"], "text": "<the memory>"}]}
- {"changes": []} when nothing should change."#;

/// The instructions, for the call.
pub(crate) fn pass_instructions() -> &'static str {
    PASS_INSTRUCTIONS
}

/// One exchange, as the pass reads it.
#[derive(Deserialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Exchange {
    /// The user's messages in the conversation so far, oldest first; the
    /// last is the exchange's own. What they typed, without the document.
    pub messages: Vec<String>,
    /// The reply to the last one.
    pub reply: String,
}

fn clip(text: &str) -> String {
    let text = text.trim();
    match text.char_indices().nth(CLIP_CHARS) {
        Some((at, _)) => format!("{}…", &text[..at]),
        None => text.to_string(),
    }
}

/// What the pass is shown: what is remembered (with ids), the library
/// entries the exchange names, whether there is a project, the exchange.
pub(crate) fn pass_input(dirs: &MemoryDirs, exchange: &Exchange) -> String {
    let memories = dirs.load();
    let remembered: Vec<String> = memories
        .items
        .iter()
        .map(|m| {
            format!(
                "- [{}] ({}, {}) {}",
                m.id,
                m.scope.as_str(),
                m.kind.as_str(),
                m.text
            )
        })
        .collect();
    let said = format!("{}\n{}", exchange.messages.join("\n"), exchange.reply);
    let library: Vec<String> = dirs
        .project
        .as_deref()
        .map(read_library)
        .unwrap_or_default()
        .into_iter()
        .filter(|e| {
            std::iter::once(&e.name)
                .chain(e.aliases.iter())
                .any(|n| said.contains(n.as_str()))
        })
        .map(|e| {
            let stem = Path::new(&e.file)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            let whose = if e.remembered.is_some() {
                format!(" [project/{LIBRARY_FOLDER}/{stem}]")
            } else {
                " - the user's own entry: never update or forget it".to_string()
            };
            let aliases = if e.aliases.is_empty() {
                String::new()
            } else {
                format!(" (also {})", e.aliases.join(", "))
            };
            format!("- {}{aliases}{whose}: {}", e.name, clip(&e.body))
        })
        .collect();
    let recent = exchange.messages.len().saturating_sub(RECENT_MESSAGES);
    let messages: Vec<String> = exchange.messages[recent..]
        .iter()
        .enumerate()
        .map(|(i, m)| format!("{}. {}", i + 1, clip(m)))
        .collect();
    let none = || "(none)".to_string();
    let join = |lines: Vec<String>| {
        if lines.is_empty() {
            none()
        } else {
            lines.join("\n")
        }
    };
    format!(
        "---already remembered---\n{}\n\n---library entries the exchange names---\n{}\n\n---project folder---\n{}\n\n---the user's messages (oldest first; the last is new)---\n{}\n\n---the assistant's reply to the last one---\n{}",
        join(remembered),
        join(library),
        if dirs.project.is_some() { "yes" } else { "none - keep only what is personal" },
        join(messages),
        clip(&exchange.reply),
    )
}

/// One change the pass asked for.
#[derive(Deserialize, Default, Debug, Clone, PartialEq)]
pub(crate) struct Change {
    #[serde(default)]
    op: String,
    id: Option<String>,
    #[serde(default)]
    kind: String,
    scope: Option<String>,
    #[serde(default)]
    text: String,
    name: Option<String>,
    #[serde(default)]
    aliases: Vec<String>,
}

/// The changes in the pass's answer - the JSON object in it, however it is
/// wrapped (a code fence, a sentence before it). Nothing when there is
/// none to read.
pub(crate) fn parse_changes(answer: &str) -> Vec<Change> {
    #[derive(Deserialize)]
    struct Answer {
        #[serde(default)]
        changes: Vec<Change>,
    }
    let (Some(start), Some(end)) = (answer.find('{'), answer.rfind('}')) else {
        return Vec::new();
    };
    if end < start {
        return Vec::new();
    }
    serde_json::from_str::<Answer>(&answer[start..=end])
        .map(|a| a.changes)
        .unwrap_or_default()
}

impl MemoryDirs {
    /// The pass's changes, made: what each did, for the chips. A change
    /// the writer refuses (a duplicate, the user's own entry, a fact with
    /// no project) is left out.
    pub(crate) fn apply_changes(
        &self,
        changes: Vec<Change>,
        source: &Source,
        now: &str,
    ) -> Vec<Remembering> {
        changes
            .into_iter()
            .filter_map(|c| {
                let id = c.id.as_deref().map(str::trim).filter(|id| !id.is_empty());
                match c.op.trim() {
                    "forget" => self.forget(id?).ok(),
                    op @ ("add" | "update") => {
                        let args = RememberArgs {
                            kind: c.kind,
                            scope: c.scope,
                            text: c.text,
                            name: c.name,
                            aliases: c.aliases,
                            replaces: None,
                        };
                        // An update names what it updates; one whose id
                        // names nothing (a fact's entry by its name, made
                        // up) is kept as an addition - a fact then joins
                        // the entry it is about (remember_fact).
                        let update = RememberArgs {
                            replaces: id.filter(|_| op == "update").map(str::to_string),
                            ..args.clone()
                        };
                        self.remember(update, source, now)
                            .or_else(|_| self.remember(args, source, now))
                            .ok()
                    }
                    _ => None,
                }
            })
            .collect()
    }

    /// A memory, or a library entry Textus AI wrote, taken back: deleted,
    /// with what it was for Undo to put back.
    pub(crate) fn forget(&self, id: &str) -> Result<Remembering, String> {
        let loc = self.locate(id)?;
        let content =
            std::fs::read_to_string(&loc.path).map_err(|_| format!("No memory `{id}`."))?;
        if loc.folder == LIBRARY_FOLDER && Remembered::from_file(&content).is_none() {
            return Err("The user's own library entry.".into());
        }
        let (front, body) = split_frontmatter(&content);
        let name = (loc.folder == LIBRARY_FOLDER)
            .then(|| front.and_then(|f| f.fields.get("name").cloned()))
            .flatten();
        self.delete(id)?;
        Ok(Remembering {
            remembered: id.to_string(),
            scope: loc.scope,
            created: false,
            text: body.trim().to_string(),
            previous: Some(content),
            name,
            forgot: true,
        })
    }
}

/// One pass: shown `exchange`, asked through `call` (instructions, input),
/// its changes made. The app's command and the live eval both run it. An
/// answer with no JSON in it is asked for again, once: MiniMax answered
/// one with nothing at all (1.2.0-rc.6), which lost a "forget that".
pub async fn run_pass<F, Fut>(
    dirs: &MemoryDirs,
    exchange: &Exchange,
    source: &Source,
    call: F,
) -> Result<Vec<Remembering>, String>
where
    F: Fn(String, String) -> Fut,
    Fut: std::future::Future<Output = Result<String, String>>,
{
    let input = pass_input(dirs, exchange);
    let mut answer = call(pass_instructions().to_string(), input.clone()).await?;
    if !answer.contains('{') {
        answer = call(pass_instructions().to_string(), input).await?;
    }
    Ok(dirs.apply_changes(parse_changes(&answer), source, &now()))
}

#[cfg(test)]
mod tests;
