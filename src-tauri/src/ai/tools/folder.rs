//! The tools that reach past the document: comments, skills, memory, and
//! the project folder's files.

use super::*;

pub(crate) const ADD_COMMENT_TOOL_NAME: &str = "add_comment";
pub(super) const COMMENT_ADDED: &str = "Comment added";

/// Feedback pinned to a passage instead of an edit to it - for "what's weak
/// here", "review this draft". Changes nothing; its block is checked like
/// propose_edit's so the card's "locate" button lands on it.
pub(super) fn add_comment(ctx: &ToolContext, arguments: &str) -> String {
    let parsed: serde_json::Value = serde_json::from_str(arguments).unwrap_or_default();
    let comment = parsed.get("comment").and_then(|v| v.as_str()).unwrap_or("");
    if comment.trim().is_empty() {
        return "`comment` is required - the feedback itself.".to_string();
    }
    match crate::ai::doc_blocks::check_target(ctx.document, &parsed) {
        Ok(()) => format!("{COMMENT_ADDED} - the user sees it with a button that jumps to the passage. Don't repeat it in your reply."),
        Err(problem) => problem,
    }
}

pub(super) const USE_SKILL_TOOL_NAME: &str = "use_skill";

/// Dynamic skill loading: the system prompt only carries each skill's name
/// and description; this returns the full instructions on demand, with the
/// reference-pack sections the skill declares appended (builtin::
/// expand_skill). A reference pack loads by name too, whole or one section
/// (`standards-fr#dialogue`).
pub(super) fn use_skill(ctx: &ToolContext, arguments: &str) -> String {
    let name = serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|v| {
            v.get("name")
                .and_then(|n| n.as_str())
                .map(|s| s.trim().to_string())
        })
        .unwrap_or_default();

    let skill = ctx.skills.iter().find(|s| s.name == name && s.enabled);
    match skill {
        Some(skill) if skill.invocation == Invocation::UserOnly => format!(
            "The skill `{name}` runs only when the user types /{name}. Handle this request without it."
        ),
        Some(skill) => format!(
            "Instructions for skill `{name}` - follow them for this request:\n\n{}",
            builtin::expand_skill(
                skill,
                ctx.document,
                ctx.ui_language,
                "",
                builtin::chosen_profile(ctx.conventions, ctx.document).as_deref(),
            )
        ),
        None if name == crate::ai::agent::APP_GUIDE => format!(
            "The app guide - answer from it:\n\n{}",
            crate::ai::agent::app_guide()
        ),
        None => match builtin::load_reference(&name, ctx.document, ctx.ui_language) {
            Some(text) => format!("Reference `{name}` - apply it to this request:\n\n{text}"),
            None => {
                let available: Vec<&str> = ctx
                    .skills
                    .iter()
                    .filter(|s| s.offered_to_model())
                    .map(|s| s.name.as_str())
                    .collect();
                format!(
                    "No skill named `{name}`. Available skills: {}. Reference packs: {} (add #section for one section).",
                    available.join(", "),
                    builtin::reference_pack_names().join(", ")
                )
            }
        },
    }
}

pub(super) const READ_FILE_TOOL_NAME: &str = "read_file";

/// How much of the project the listing shows: enough for reference
/// material next to the document, small enough that a huge folder can't
/// blow up the prompt.
pub(super) const MAX_LISTED_FILES: usize = 200;
pub(super) const SEARCH_FILES_TOOL_NAME: &str = "search_files";
pub(super) const FIND_FILES_TOOL_NAME: &str = "find_files";

/// The project folder's files the tools can read (paths relative to it),
/// images marked - find_files with no name. Hidden entries and
/// build/dependency folders are skipped - see ai::project.
fn list_files(ctx: &ToolContext, root: &std::path::Path) -> String {
    let walked = crate::ai::project::walk_readable_files(root, ctx.sees_images);
    let files = walked.files;
    if files.is_empty() {
        return "The project folder has no files to read.".to_string();
    }
    let mut lines: Vec<String> = files
        .iter()
        .take(MAX_LISTED_FILES)
        .map(|rel| crate::ai::project::listed(rel))
        .collect();
    if files.len() > MAX_LISTED_FILES || walked.truncated {
        let more = files.len().saturating_sub(MAX_LISTED_FILES);
        let more = if walked.truncated {
            format!("{more} or more")
        } else {
            more.to_string()
        };
        lines.push(format!(
            "... ({more} more - use find_files for a file by name, search_files for words inside files)"
        ));
    }
    lines.join("\n")
}

pub(super) fn path_argument(arguments: &str, key: &str) -> String {
    serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|v| v.get(key).and_then(|p| p.as_str()).map(str::to_string))
        .unwrap_or_default()
}

/// Reads a text file or a document from inside the project folder, whole
/// or a line range of it - containment, hidden files and size are enforced
/// by ai::project::read_part - or shows an image to a model that sees
/// them.
pub(super) fn read_file(ctx: &ToolContext, arguments: &str) -> ToolOutput {
    let Some(root) = ctx.root else {
        return "There is no project folder for this document (it hasn't been saved, or its folder is too broad to use), so there are no files to read."
            .to_string()
            .into();
    };
    // find_files marks images "(image)"; a model may copy it.
    let path = path_argument(arguments, "path");
    let path = path.trim().trim_end_matches("(image)").trim_end();
    let is_image = crate::ai::project::file_kind(std::path::Path::new(path))
        == Some(crate::ai::project::FileKind::Image);
    if is_image && ctx.sees_images {
        return view_image(root, path);
    }
    let args: serde_json::Value = serde_json::from_str(arguments).unwrap_or_default();
    let line = |key: &str| args.get(key).and_then(|v| v.as_u64()).map(|n| n as usize);
    let range = crate::ai::project::LineRange {
        start: line("start_line"),
        end: line("end_line"),
    };
    crate::ai::project::read_part(root, path, range)
        .unwrap_or_else(|err| err)
        .into()
}

/// An image from the project folder, for a model that sees images
/// (ToolContext::sees_images).
fn view_image(root: &std::path::Path, path: &str) -> ToolOutput {
    match crate::ai::project::read_image(root, path) {
        Ok(image) => ToolOutput {
            text: format!("Here is `{}` ({}).", image.name, image.mime),
            images: vec![image],
            ..ToolOutput::default()
        },
        Err(err) => err.into(),
    }
}

/// Finds which project files mention something - the cross-file companion
/// to search_document.
pub(super) fn search_files(ctx: &ToolContext, arguments: &str) -> String {
    let Some(root) = ctx.root else {
        return "There is no project folder for this document (it hasn't been saved, or its folder is too broad to use), so there is nothing to search."
            .to_string();
    };
    crate::ai::project::search(root, &path_argument(arguments, "query"))
}

/// Finds project files by name - what the sidebar's file search does for
/// the writer, and cheaper for the model than listing everything - or,
/// with no name, lists them.
pub(super) fn find_files(ctx: &ToolContext, arguments: &str) -> String {
    let Some(root) = ctx.root else {
        return "There is no project folder for this document (it hasn't been saved, or its folder is too broad to use), so there are no files to find."
            .to_string();
    };
    let name = path_argument(arguments, "name");
    if name.trim().is_empty() {
        return list_files(ctx, root);
    }
    crate::ai::project::find(root, &name, ctx.sees_images)
}
