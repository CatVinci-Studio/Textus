//! What Textus AI remembers by itself (docs/design/ai-concepts.md, "AI
//! memories"): the user's standing requirements, preferences and style,
//! kept with the `remember` tool in any conversation and sent with every
//! later one - so "it remembers your style and what you ask for" holds.
//!
//! One memory per Markdown file, written only by Textus AI and kept apart
//! from the files the user writes (agent.md, style.md), which it never
//! changes:
//!
//! ```text
//! <global config folder>/memory/<slug>.md   <- personal: the user's habits
//! <project folder>/.textus/memory/<slug>.md <- about this work
//! <project folder>/.textus/library/<name>.md
//!                       <- a fact about the work (a person, place, term),
//!                          in the library, marked `remembered-by`
//! ```
//!
//! ```text
//! ---
//! kind: preference          # requirement | preference | style
//! remembered-by: textus-ai
//! created: 2026-10-18T09:30:00Z
//! updated: 2026-10-18T09:30:00Z
//! source-conversation: <conversation id>
//! source-title: "Tighten the opening"
//! source-document: /path/to/chapter-1.md
//! ---
//! Keep sentences short; no semicolons.
//! ```
//!
//! A memory is named by its id, `<scope>/<folder>/<file stem>`
//! (`personal/memory/no-semicolons`, `project/library/lin-wan`): what the
//! model sees next to each memory and passes back to update one, and what
//! the chat's chip and the Memory tab undo, move and delete by.

use crate::ai::project::{read_library, LibraryEntry};
use crate::ai::workspace::{
    global_agent_dir, project_dir, project_root, safe_file_stem, split_frontmatter,
    strip_html_comments,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

mod dirs;

mod files;
pub(crate) use files::*;
mod prompt;
pub(crate) use prompt::*;

/// Most memory text sent with one request, in characters (not bytes, so
/// Chinese and Japanese get as much as English): about 40 memories of a
/// sentence or two. Past it the oldest are left out - and the Memory tab
/// says so.
pub const MAX_MEMORY_CHARS: usize = 4_000;

/// A memory is a sentence or a few, not a document.
const MAX_TEXT_CHARS: usize = 600;

/// The settings.json field of Settings > Textus AI > Remember
/// automatically (`rememberAutomatically` in SettingsContext.tsx). Missing
/// means on.
pub(crate) const REMEMBER_SETTING: &str = "rememberAutomatically";

/// The front-matter mark on what Textus AI wrote.
const MARK_KEY: &str = "remembered-by";
const MARK: &str = "textus-ai";

/// The log of accepted and rejected kinds of revision that suggestions are
/// learned from (`ChoiceLog` in src/ai/revision/revision-learning.ts,
/// which owns its shape and keeps it bounded). One hidden file beside the
/// personal memories - not a memory, so the Memory tab and the prompt never
/// list it, and it is never sent anywhere.
const CHOICES_FILE: &str = ".revision-choices.json";

/// A few hundred short entries fit many times over; past this a write is
/// refused rather than let the file grow.
const MAX_CHOICES_BYTES: usize = 64 * 1024;

const MEMORY_FOLDER: &str = "memory";
const LIBRARY_FOLDER: &str = "library";

/// Whether Textus AI may remember things by itself.
pub fn remember_enabled(app: &tauri::AppHandle) -> bool {
    crate::settings::read_setting(app, REMEMBER_SETTING)
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

/// What a memory is about. Facts about the work are not a kind: they go
/// into the library, where the existing matching sends each only when it
/// comes up.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MemoryKind {
    /// Something the user asked to be always or never done.
    Requirement,
    /// What the user likes or dislikes in replies and edits.
    Preference,
    /// How the user writes.
    Style,
}

impl MemoryKind {
    fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "requirement" => Some(Self::Requirement),
            "preference" => Some(Self::Preference),
            "style" => Some(Self::Style),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Requirement => "requirement",
            Self::Preference => "preference",
            Self::Style => "style",
        }
    }
}

/// Whose a memory is: the user's in general (the global config folder) or
/// this project's (its `.textus/`).
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    Project,
    Personal,
}

impl Scope {
    fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "project" => Some(Self::Project),
            "personal" => Some(Self::Personal),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Project => "project",
            Self::Personal => "personal",
        }
    }
}

/// Where and when something was remembered. Serialised camelCase for the
/// Memory tab (`Remembered` in platform/ipc.ts).
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Remembered {
    pub created: String,
    pub updated: String,
    /// The conversation it came from (useAgentConversation's id) and its
    /// title, and the document open then.
    pub conversation: Option<String>,
    pub title: Option<String>,
    pub document: Option<String>,
}

impl Remembered {
    /// The record in a file Textus AI wrote (`remembered-by: textus-ai`);
    /// None for one the user wrote.
    pub fn from_file(content: &str) -> Option<Self> {
        let (front, _) = split_frontmatter(content);
        let fields = front?.fields;
        (fields.get(MARK_KEY).map(|v| v.trim()) == Some(MARK)).then(|| Self::from_fields(&fields))
    }

    fn from_fields(fields: &BTreeMap<String, String>) -> Self {
        let get = |key: &str| {
            fields
                .get(key)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        Self {
            created: get("created").unwrap_or_default(),
            updated: get("updated")
                .or_else(|| get("created"))
                .unwrap_or_default(),
            conversation: get("source-conversation"),
            title: get("source-title"),
            document: get("source-document"),
        }
    }

    /// The front-matter lines for this record, the mark first.
    fn lines(&self) -> String {
        let mut out = format!(
            "{MARK_KEY}: {MARK}\ncreated: {}\nupdated: {}\n",
            self.created, self.updated
        );
        for (key, value) in [
            ("source-conversation", &self.conversation),
            ("source-title", &self.title),
            ("source-document", &self.document),
        ] {
            if let Some(value) = value {
                out.push_str(&format!("{key}: {}\n", quoted(value)));
            }
        }
        out
    }
}

/// A one-line YAML double-quoted scalar - what split_frontmatter unquotes.
fn quoted(value: &str) -> String {
    let line: String = value
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    format!("\"{}\"", line.replace('\\', "\\\\").replace('"', "\\\""))
}

/// One memory, as the Memory tab and the prompt see it. Serialised
/// camelCase (`Memory` in platform/ipc.ts).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub id: String,
    pub scope: Scope,
    pub kind: MemoryKind,
    pub text: String,
    /// The file's absolute path, for Edit.
    pub file: String,
    pub remembered: Remembered,
    /// Whether it fits under MAX_MEMORY_CHARS and so goes with requests.
    pub included: bool,
}

/// Every memory for a document - personal first, then the project's,
/// newest first in each - and how much of the budget the included ones use.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Memories {
    pub items: Vec<Memory>,
    /// Characters of the included memories.
    pub chars: usize,
    /// MAX_MEMORY_CHARS.
    pub cap: usize,
}

/// Where something is remembered from, for the record: the conversation
/// as ai_agent_message gets it (`conversation: {id, title}` in
/// platform/ipc.ts) and the document open in it.
#[derive(Deserialize, Clone, Debug, Default)]
pub struct Source {
    #[serde(rename = "id")]
    pub conversation: Option<String>,
    pub title: Option<String>,
    #[serde(skip)]
    pub document: Option<String>,
}

/// The folders memories live in for one document: the global config
/// folder (personal) and the project folder, either possibly missing.
#[derive(Clone, Debug, Default)]
pub struct MemoryDirs {
    personal: Option<PathBuf>,
    project: Option<PathBuf>,
}

/// Everything the remember tool needs for one request.
pub struct MemoryContext {
    pub dirs: MemoryDirs,
    pub source: Source,
}

/// A memory's file, found from its id.
pub(crate) struct Located {
    scope: Scope,
    folder: &'static str,
    path: PathBuf,
}

/// What a remember call did - the tool's result, which the chat's chip
/// reads to show it and to undo it (`RememberResult` in
/// src/ai/chat/MemoryChip.tsx). `previous` is the file as it was before an
/// update, for Undo to put back.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Remembering {
    pub remembered: String,
    pub scope: Scope,
    pub created: bool,
    pub text: String,
    pub previous: Option<String>,
    /// For the model.
    pub note: &'static str,
}

/// The remember tool's arguments (tools.rs has the schema).
#[derive(Deserialize, Default)]
pub(crate) struct RememberArgs {
    #[serde(default)]
    kind: String,
    scope: Option<String>,
    #[serde(default)]
    text: String,
    name: Option<String>,
    #[serde(default)]
    aliases: Vec<String>,
    replaces: Option<String>,
}

/// Told to the model with every saved memory.
const SAVED_NOTE: &str =
    "Saved. The user sees it under your reply with Undo; mention it in a few words at most.";

/// The remember tool (tools.rs): the model's JSON arguments in, the
/// Remembering as JSON (or what went wrong, in words) out.
pub fn run_tool(ctx: &MemoryContext, arguments: &str) -> String {
    let args: RememberArgs = match serde_json::from_str(arguments) {
        Ok(args) => args,
        Err(_) => return "Invalid arguments - expected JSON with `kind` and `text`.".to_string(),
    };
    match ctx.dirs.remember(args, &ctx.source, &now()) {
        Ok(done) => serde_json::to_string(&done).unwrap_or_default(),
        Err(problem) => problem,
    }
}

// ----------------------------------------------------------------- commands

/// The chat chip's Undo: deletes what a remember call created, or writes
/// back `previous`, the file before it was updated.
#[tauri::command]
pub async fn memory_undo(
    app: tauri::AppHandle,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    id: String,
    previous: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        MemoryDirs::for_document(&app, doc_path.as_deref(), workspace_root.as_deref())
            .undo(&id, previous.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// "Make personal" / "Make project", in the chat chip and the Memory tab.
/// Returns the memory's new id.
#[tauri::command]
pub async fn memory_move(
    app: tauri::AppHandle,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    id: String,
    scope: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let scope = Scope::parse(&scope).ok_or("Unknown scope.")?;
        MemoryDirs::for_document(&app, doc_path.as_deref(), workspace_root.as_deref())
            .move_to(&id, scope)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The Memory tab's Delete, for a memory or a library entry.
#[tauri::command]
pub async fn memory_delete(
    app: tauri::AppHandle,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        MemoryDirs::for_document(&app, doc_path.as_deref(), workspace_root.as_deref()).delete(&id)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// "Remember" on a suggestion learned from revision choices
/// (src/ai/revision/RevisionLearning.tsx): one memory the user asked for
/// with a click, written as the remember tool writes it - so it is listed,
/// moved and deleted in the Memory tab like any other. A click, not the
/// model: it saves whether or not Remember automatically is on.
#[tauri::command]
pub async fn memory_remember(
    app: tauri::AppHandle,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    kind: String,
    scope: String,
    text: String,
) -> Result<Remembering, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = MemoryDirs::for_document(&app, doc_path.as_deref(), workspace_root.as_deref());
        let source = Source {
            document: doc_path,
            ..Source::default()
        };
        dirs.remember(
            RememberArgs {
                kind,
                scope: Some(scope),
                text,
                ..RememberArgs::default()
            },
            &source,
            &now(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn revision_choices_read(app: tauri::AppHandle) -> Option<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || {
        MemoryDirs::for_document(&app, None, None).read_choices()
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub async fn revision_choices_write(
    app: tauri::AppHandle,
    log: serde_json::Value,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        MemoryDirs::for_document(&app, None, None).write_choices(&log)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests;
