//! What Textus AI remembers by itself: the user's standing requirements,
//! preferences and style, one Markdown file each under `memory/` (personal or
//! the project's), facts about the work in the library. Named by id, e.g.
//! `personal/memory/no-semicolons`.

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
mod forgotten;
pub use forgotten::Forgotten;
mod pass;
mod select;
mod skill_offer;
mod tidy;
pub use pass::*;
pub use skill_offer::*;
pub use tidy::*;
mod commands;
pub use commands::*;

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

pub(crate) const MEMORY_FOLDER: &str = "memory";
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

#[cfg(test)]
mod tests;
