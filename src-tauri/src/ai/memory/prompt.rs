//! What a request is told about memory: how to use the remember tool,
//! and the remembered sections - the writer's requirements, preferences
//! and style, global and the project's.

use super::*;

// ------------------------------------------------------------------- prompt

/// How Textus AI is told to use the remember tool - only when it has it.
pub(crate) const REMEMBER_INSTRUCTIONS: &str = "You can remember things for later conversations with the remember tool. Call it when the user states, or clearly shows by correcting you, something that should hold beyond this request: a requirement (\"always…\", \"never…\", \"from now on…\"), a preference about your replies and edits, or a trait of how they write (kind requirement, preference or style); or a fact about their work - a person, place or term and what is true of it (kind fact, with its name and any aliases; it goes into the project's library). A fact counts even when the user tells it to you in passing, as background to a request (\"Lin is the heroine, a lighthouse keeper - write the next scene\"): it holds for the rest of the work, so remember it before you go on. Don't remember a one-off request, what the document already says, your own suggestions, or anything private such as passwords, addresses or health details. Scope: something about this work (its characters, its terms, how this piece must be written) is project; the user's general habits and preferences are personal; with no project folder everything is personal. Before remembering, check what you already remember below: to change or correct one, call remember with `replaces` set to its id instead of adding another. Write each memory as one or a few plain sentences in the user's language, as an instruction to yourself (\"Use 「」 for quotations.\"). The ids in brackets are for the tool only - never show them to the user. Never tell the user you will do something from now on, or in later conversations, without calling remember for it in this reply: only what you remember reaches them.";

/// How to use the remember tool, for the system prompt - while it is
/// offered. What has been remembered goes with each message instead
/// ([`memory_sections`]), so saving a memory doesn't change the system
/// prompt and its cache.
pub fn remember_instructions(has_project: bool, remember: bool) -> Option<String> {
    if !remember {
        return None;
    }
    let mut text = format!("---remembering---\n{REMEMBER_INSTRUCTIONS}");
    if !has_project {
        text.push_str(
            "\nThere is no project folder now, so nothing can be remembered for this work alone: don't remember its characters, places or terms, or how this piece must be written - a personal memory goes with every document the user writes. Remember only the user's general habits and preferences, as personal; if they ask you to remember something about this work, say in a sentence that it needs a project folder.",
        );
    }
    Some(text)
}

/// The prompt sections for what Textus AI remembered (after the user's
/// writing instructions): personal first, then the project's, which wins a
/// conflict - as with agent.md. `remember`: the tool is offered, so ids
/// and the library entries it wrote are listed too.
pub fn memory_sections(
    memories: &Memories,
    library: &[LibraryEntry],
    remember: bool,
) -> Vec<String> {
    let line = |m: &Memory| {
        if remember {
            format!("- [{}] ({}) {}", m.id, m.kind.as_str(), m.text)
        } else {
            format!("- ({}) {}", m.kind.as_str(), m.text)
        }
    };
    let lines = |scope: Scope| -> Vec<String> {
        memories
            .items
            .iter()
            .filter(|m| m.scope == scope && m.included)
            .map(line)
            .collect()
    };
    let mut sections = Vec::new();
    let personal = lines(Scope::Personal);
    let project = lines(Scope::Project);
    if !personal.is_empty() {
        sections.push(format!(
            "---what you remember about the user (personal, from earlier conversations; the user instructions above win where they conflict)---\n{}",
            personal.join("\n")
        ));
    }
    if !project.is_empty() {
        sections.push(format!(
            "---what you remember about this project ({}the user instructions above win where they conflict)---\n{}",
            if personal.is_empty() { "" } else { "where these conflict with the personal memories above, follow these; " },
            project.join("\n")
        ));
    }
    let left_out = memories.items.iter().filter(|m| !m.included).count();
    if left_out > 0 {
        sections.push(format!(
            "({left_out} older memories don't fit here and are not shown.)"
        ));
    }
    if remember {
        let facts: Vec<String> = library
            .iter()
            .filter(|e| e.remembered.is_some())
            .map(|e| {
                let stem = Path::new(&e.file)
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default();
                format!("- [project/{LIBRARY_FOLDER}/{stem}] {}", e.name)
            })
            .collect();
        if !facts.is_empty() {
            sections.push(format!(
                "---library entries you wrote (update one with remember's replaces; the others are the user's and you never change them)---\n{}",
                facts.join("\n")
            ));
        }
    }
    sections
}
