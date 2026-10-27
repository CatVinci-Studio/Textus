//! What a request is told it remembers: the writer's requirements,
//! preferences and style, global and the project's.

use super::*;

// ------------------------------------------------------------------- prompt

/// The prompt sections for what Textus AI remembered: personal first, then the
/// project's, which wins a conflict. Facts go with the library instead.
pub fn memory_sections(memories: &Memories) -> Vec<String> {
    let line = |m: &Memory| format!("- ({}) {}", m.kind.as_str(), m.text);
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
    sections
}
