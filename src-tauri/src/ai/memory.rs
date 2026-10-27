//! What Textus AI remembers by itself: the user's standing requirements,
//! preferences and style, one Markdown file each under `memory/` (personal or
//! the project's), facts about the work in the library. Named by id, e.g.
//! `personal/memory/no-semicolons`.

use crate::ai::project::{read_library, LibraryEntry};
use crate::ai::workspace::{
    global_agent_dir, project_dir, project_root, safe_file_stem, split_frontmatter,
    strip_html_comments,
};
use crate::commands::args::Args;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

mod dirs;

mod files;
pub(crate) use files::*;
mod prompt;
pub(crate) use prompt::*;
mod forgotten;
pub use forgotten::Forgotten;
mod pass;
mod select;
mod skill_offer;
mod tidy;
pub use pass::*;
pub use skill_offer::*;
pub use tidy::*;

/// Most memory text sent with one request, in characters (not bytes, so CJK
/// gets as much). Past it the oldest are left out, and the Memory tab says so.
pub const MAX_MEMORY_CHARS: usize = 4_000;

/// A memory is a sentence or a few, not a document.
const MAX_TEXT_CHARS: usize = 600;

/// The settings.json field of Settings > Textus AI > Remember automatically.
/// Missing means on.
pub(crate) const REMEMBER_SETTING: &str = "rememberAutomatically";

/// The front-matter mark on what Textus AI wrote.
const MARK_KEY: &str = "remembered-by";
const MARK: &str = "textus-ai";

/// The frontend-owned log of accepted and rejected kinds of revision. One
/// hidden file beside the personal memories: never listed, never sent.
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

/// What a memory is about. Facts about the work are not a kind: they go into
/// the library.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
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
#[cfg_attr(test, derive(specta::Type))]
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

/// Where and when something was remembered, serialised camelCase for the
/// Memory tab.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Remembered {
    pub created: String,
    pub updated: String,
    /// The conversation it came from and its title, and the document open then.
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

/// One memory, as the Memory tab and the prompt see it. Serialised camelCase.
#[derive(Serialize, Clone, Debug)]
#[cfg_attr(test, derive(specta::Type))]
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
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Memories {
    pub items: Vec<Memory>,
    /// Characters of the included memories.
    pub chars: usize,
    /// MAX_MEMORY_CHARS.
    pub cap: usize,
    /// What was deleted or forgotten lately, newest first, to bring back.
    pub forgotten: Vec<Forgotten>,
}

/// Where something is remembered from, for the record: the conversation as
/// ai_agent_message gets it and the document open in it.
#[derive(Deserialize, Clone, Debug, Default)]
#[cfg_attr(test, derive(specta::Type), serde(rename = "MemorySource"))]
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

/// A memory's file, found from its id.
pub(crate) struct Located {
    scope: Scope,
    folder: &'static str,
    path: PathBuf,
}

/// What a remember call did, which the chat's chip shows and undoes.
/// `previous` is the file as it was before an update, for Undo to put back.
#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Remembering {
    pub remembered: String,
    pub scope: Scope,
    pub created: bool,
    pub text: String,
    pub previous: Option<String>,
    /// For a library entry: whom or what it is about, which `text` (its
    /// body) doesn't say.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// What was remembered was taken back: `text` is what it said, `previous` the
    /// file Undo puts back.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub forgot: bool,
}

/// What to remember: a change memory::pass asked for, or one the user
/// asked for with a click.
#[derive(Deserialize, Default, Clone)]
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

impl MemoryDirs {
    /// One memory kept as it was asked for: a suggestion's Remember, or a live
    /// eval's memories from before.
    pub fn keep(
        &self,
        kind: &str,
        scope: &str,
        text: &str,
        source: &Source,
    ) -> Result<Remembering, String> {
        let args = RememberArgs {
            kind: kind.into(),
            scope: Some(scope.into()),
            text: text.into(),
            ..RememberArgs::default()
        };
        self.remember(args, source, &now())
    }
}

// ----------------------------------------------------------------- commands

/// memory_pass's inputs, the keys of `ai.memoryPass`'s invoke.
#[derive(Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PassRequest {
    provider: String,
    model: Option<String>,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    conversation: Option<Source>,
    exchange: Exchange,
}

/// After each exchange: what to remember, update or forget, decided by the
/// conversation's own model, each change for a chip under the reply. Nothing
/// while Remember automatically is off.
#[tauri::command]
pub async fn memory_pass(
    app: tauri::AppHandle,
    request: Args<PassRequest>,
) -> Result<Vec<Remembering>, String> {
    let Args(PassRequest {
        provider,
        model,
        doc_path,
        workspace_root,
        conversation,
        exchange,
    }) = request;
    crate::ai::ensure_on(&app)?;
    if !remember_enabled(&app) {
        return Ok(Vec::new());
    }
    let dirs = MemoryDirs::for_document(&app, doc_path.as_deref(), workspace_root.as_deref());
    let source = Source {
        document: doc_path,
        ..conversation.unwrap_or_default()
    };
    let call = |instructions, input| async {
        crate::ai::client::call(&app, &provider, instructions, input, model.as_deref()).await
    };
    let mut made = run_pass(&dirs, &exchange, &source, call).await?;
    // Now and then, the whole memory tidied. Its failing takes nothing from the
    // exchange's own changes.
    made.extend(tidy_if_due(&dirs, &source, call).await.unwrap_or_default());
    Ok(made)
}

/// ai_offer_skill's inputs, as memory_pass's.
#[derive(Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OfferRequest {
    provider: String,
    model: Option<String>,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    exchange: Exchange,
}

/// After an exchange: its request offered as a skill to save, when it was a
/// procedure of its own.
#[tauri::command]
pub async fn ai_offer_skill(
    app: tauri::AppHandle,
    request: Args<OfferRequest>,
) -> Result<Option<SkillOffer>, String> {
    let Args(OfferRequest {
        provider,
        model,
        doc_path,
        workspace_root,
        exchange,
    }) = request;
    crate::ai::ensure_on(&app)?;
    if !may_offer(&exchange) {
        return Ok(None);
    }
    let skills =
        crate::ai::workspace::load(&app, doc_path.as_deref(), workspace_root.as_deref()).skills;
    offer_skill(&exchange, &skills, |instructions, input| async {
        crate::ai::client::call(&app, &provider, instructions, input, model.as_deref()).await
    })
    .await
}

/// The offered skill saved, for every document or this project's. Returns
/// its file's path.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn save_offered_skill(
    app: tauri::AppHandle,
    offer: SkillOffer,
    // "personal" or "project".
    scope: String,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    // The panel modes it is to apply in.
    modes: Vec<crate::ai::agent::AgentMode>,
) -> Result<String, String> {
    let dir = match Scope::parse(&scope).ok_or("Unknown scope.")? {
        Scope::Personal => global_agent_dir(&app)?.join("skills"),
        Scope::Project => crate::ai::workspace::project_dir(
            &project_root(doc_path.as_deref(), workspace_root.as_deref())
                .ok_or("This document has no project folder.")?,
        )
        .join("skills"),
    };
    tauri::async_runtime::spawn_blocking(move || save_offer_in(&dir, &offer, &modes))
        .await
        .map_err(|e| e.to_string())?
        .map(|p| p.to_string_lossy().into_owned())
}

/// Restore in the Memory tab's Recently forgotten: puts a forgotten memory
/// or library entry back. Returns its id.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn memory_restore(
    app: tauri::AppHandle,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        MemoryDirs::for_document(&app, doc_path.as_deref(), workspace_root.as_deref()).restore(&id)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The chat chip's Undo: deletes what a remember call created, or writes
/// back `previous`, the file before it was updated.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
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
#[cfg_attr(test, specta::specta)]
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
#[cfg_attr(test, specta::specta)]
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

/// "Remember" on a suggestion learned from revision choices: one memory
/// written as the pass writes one. A click, not the model, so it saves even
/// while Remember automatically is off.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
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
        dirs.keep(&kind, &scope, &text, &source)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn revision_choices_read(app: tauri::AppHandle) -> Option<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || {
        MemoryDirs::for_document(&app, None, None).read_choices()
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
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
