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
struct Located {
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
struct RememberArgs {
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
    /// `global_dir`: the global config folder; `root`: the project folder.
    pub fn new(global_dir: Option<&Path>, root: Option<&Path>) -> Self {
        Self {
            personal: global_dir.map(Path::to_path_buf),
            project: root.map(Path::to_path_buf),
        }
    }

    /// The memory folders of a document, as the commands resolve them.
    pub fn for_document(
        app: &tauri::AppHandle,
        doc_path: Option<&str>,
        workspace_root: Option<&str>,
    ) -> Self {
        Self {
            personal: global_agent_dir(app).ok(),
            project: project_root(doc_path, workspace_root),
        }
    }

    /// The folder for `scope`'s memories or library; the library is the
    /// project's only.
    fn folder(&self, scope: Scope, folder: &str) -> Option<PathBuf> {
        match (scope, folder) {
            (Scope::Personal, MEMORY_FOLDER) => Some(self.personal.as_ref()?.join(MEMORY_FOLDER)),
            (Scope::Project, MEMORY_FOLDER | LIBRARY_FOLDER) => {
                Some(project_dir(self.project.as_ref()?).join(folder))
            }
            _ => None,
        }
    }

    /// The file an id names - only ever a `.md` file directly inside one
    /// of the memory folders or the project's library, and never a link.
    fn locate(&self, id: &str) -> Result<Located, String> {
        let unknown = || format!("No memory `{id}`.");
        let mut parts = id.trim().splitn(3, '/');
        let scope = parts.next().and_then(Scope::parse).ok_or_else(unknown)?;
        let folder = match parts.next() {
            Some(MEMORY_FOLDER) => MEMORY_FOLDER,
            Some(LIBRARY_FOLDER) => LIBRARY_FOLDER,
            _ => return Err(unknown()),
        };
        let stem = parts.next().unwrap_or_default();
        if stem.is_empty()
            || stem.starts_with('.')
            || stem.contains(['/', '\\'])
            || stem.chars().any(char::is_control)
        {
            return Err(unknown());
        }
        let dir = self.folder(scope, folder).ok_or_else(unknown)?;
        let path = dir.join(format!("{stem}.md"));
        if path.parent() != Some(dir.as_path()) {
            return Err(unknown());
        }
        if let Ok(meta) = std::fs::symlink_metadata(&path) {
            if !meta.file_type().is_file() {
                return Err(unknown());
            }
        }
        Ok(Located {
            scope,
            folder,
            path,
        })
    }

    /// Every memory, personal first, with MAX_MEMORY_CHARS spent on the
    /// project's newest first (they win a conflict), then the personal
    /// ones' newest first.
    pub fn load(&self) -> Memories {
        let mut items = self.read(Scope::Personal);
        items.extend(self.read(Scope::Project));
        let mut order: Vec<usize> = (0..items.len()).collect();
        order.sort_by(|&a, &b| {
            let rank = |m: &Memory| (m.scope == Scope::Personal) as u8;
            rank(&items[a]).cmp(&rank(&items[b])).then_with(|| {
                items[b]
                    .remembered
                    .updated
                    .cmp(&items[a].remembered.updated)
            })
        });
        let mut chars = 0;
        for i in order {
            let size = items[i].text.chars().count();
            if chars + size <= MAX_MEMORY_CHARS {
                chars += size;
                items[i].included = true;
            }
        }
        Memories {
            items,
            chars,
            cap: MAX_MEMORY_CHARS,
        }
    }

    /// One scope's memories, newest first.
    fn read(&self, scope: Scope) -> Vec<Memory> {
        let Some(dir) = self.folder(scope, MEMORY_FOLDER) else {
            return Vec::new();
        };
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return Vec::new();
        };
        let mut items: Vec<Memory> = entries
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("md"))
            .filter_map(|path| {
                let stem = path.file_stem()?.to_str()?.to_string();
                let content = std::fs::read_to_string(&path).ok()?;
                let (front, body) = split_frontmatter(&content);
                let fields = front.map(|f| f.fields).unwrap_or_default();
                let text = strip_html_comments(&body).trim().to_string();
                (!text.is_empty()).then(|| Memory {
                    id: format!("{}/{MEMORY_FOLDER}/{stem}", scope.as_str()),
                    scope,
                    kind: fields
                        .get("kind")
                        .and_then(|k| MemoryKind::parse(k))
                        .unwrap_or(MemoryKind::Preference),
                    text,
                    file: path.to_string_lossy().into_owned(),
                    remembered: Remembered::from_fields(&fields),
                    included: false,
                })
            })
            .collect();
        items.sort_by(|a, b| {
            b.remembered
                .updated
                .cmp(&a.remembered.updated)
                .then_with(|| a.id.cmp(&b.id))
        });
        items
    }

    /// The remember tool: validates, refuses a duplicate, and writes one
    /// memory (or library entry) through the atomic writer. The error is
    /// what the model is told instead.
    fn remember(
        &self,
        args: RememberArgs,
        source: &Source,
        now: &str,
    ) -> Result<Remembering, String> {
        let text = args.text.trim();
        if text.is_empty() {
            return Err("`text` is required: the memory itself, in one or a few sentences.".into());
        }
        if text.chars().count() > MAX_TEXT_CHARS {
            return Err(format!("That is too long for a memory ({} characters): keep it to one or a few sentences, at most {MAX_TEXT_CHARS} characters.", text.chars().count()));
        }
        if args.kind.trim() == "fact" {
            return self.remember_fact(&args, text, source, now);
        }
        let kind = MemoryKind::parse(&args.kind)
            .ok_or("`kind` must be requirement, preference, style or fact.")?;
        let replaced = args
            .replaces
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(|id| self.locate(id).map(|loc| (id, loc)))
            .transpose()?;
        if let Some((id, loc)) = &replaced {
            if loc.folder != MEMORY_FOLDER || !loc.path.is_file() {
                return Err(format!("No memory `{id}` to replace - use an id listed under what you remember, or leave `replaces` out."));
            }
        }
        let key = normalized(text);
        if let Some(same) = self
            .load()
            .items
            .into_iter()
            .find(|m| normalized(&m.text) == key)
        {
            return Err(format!(
                "Already remembered as `{}` - nothing saved.",
                same.id
            ));
        }
        let (scope, path, previous, mut record) = match replaced {
            Some((_, loc)) => {
                let previous = std::fs::read_to_string(&loc.path).map_err(|e| e.to_string())?;
                let (front, _) = split_frontmatter(&previous);
                let record = Remembered::from_fields(&front.map(|f| f.fields).unwrap_or_default());
                (loc.scope, loc.path, Some(previous), record)
            }
            None => {
                // The scope rule (also in the prompt): without a project,
                // everything is personal.
                let scope = match args.scope.as_deref().and_then(Scope::parse) {
                    Some(Scope::Project) | None if self.project.is_some() => Scope::Project,
                    _ => Scope::Personal,
                };
                let dir = self
                    .folder(scope, MEMORY_FOLDER)
                    .ok_or("Nowhere to keep memories: the app's config folder isn't available.")?;
                let path = free_path(&dir, &memory_stem(text));
                (scope, path, None, Remembered::default())
            }
        };
        if record.created.is_empty() {
            record.created = now.to_string();
        }
        record.updated = now.to_string();
        record.conversation = source.conversation.clone();
        record.title = source.title.clone();
        record.document = source.document.clone();
        let content = format!(
            "---\nkind: {}\n{}---\n{text}\n",
            kind.as_str(),
            record.lines()
        );
        write(&path, &content)?;
        Ok(Remembering {
            remembered: id_of(scope, MEMORY_FOLDER, &path),
            scope,
            created: previous.is_none(),
            text: text.to_string(),
            previous,
            note: SAVED_NOTE,
        })
    }

    /// A fact about the work: a library entry (`name`, `aliases`), new or
    /// one Textus AI wrote before - never one the user wrote.
    fn remember_fact(
        &self,
        args: &RememberArgs,
        text: &str,
        source: &Source,
        now: &str,
    ) -> Result<Remembering, String> {
        let (Some(root), Some(dir)) = (&self.project, self.folder(Scope::Project, LIBRARY_FOLDER))
        else {
            return Err("There is no project folder (the document isn't saved, or its folder is too broad), so there is no library to keep facts about the work in. Don't remember it; if it matters, tell the user that saving the document lets you.".into());
        };
        let name = one_line(args.name.as_deref().unwrap_or_default());
        if name.is_empty() {
            return Err(
                "`name` is required for a fact: the person, place or term it is about.".into(),
            );
        }
        let aliases: Vec<String> = args
            .aliases
            .iter()
            .map(|a| {
                one_line(a)
                    .replace([',', '，', '、', '[', ']'], " ")
                    .trim()
                    .to_string()
            })
            .filter(|a| a.to_lowercase() != name.to_lowercase() && !too_short_an_alias(a))
            .collect();
        let library = read_library(root);
        let stem_of = |entry: &LibraryEntry| {
            Path::new(&entry.file)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default()
        };
        let existing = match args
            .replaces
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
        {
            Some(id) => {
                let loc = self.locate(id)?;
                let entry = library
                    .iter()
                    .find(|e| loc.folder == LIBRARY_FOLDER && stem_of(e) == file_stem(&loc.path))
                    .ok_or_else(|| format!("No library entry `{id}` to replace."))?;
                Some(entry)
            }
            None => library.iter().find(|e| {
                std::iter::once(&e.name)
                    .chain(e.aliases.iter())
                    .any(|n| n.to_lowercase() == name.to_lowercase())
            }),
        };
        if let Some(entry) = existing {
            let id = format!("project/{LIBRARY_FOLDER}/{}", stem_of(entry));
            if entry.remembered.is_none() {
                return Err(format!("The library's entry for {} (`{id}`) is the user's own, and you never change it: tell the user what to add to it instead.", entry.name));
            }
            if normalized(&entry.body) == normalized(text) && entry.name == name {
                return Err(format!("Already remembered as `{id}` - nothing saved."));
            }
        }
        let (path, previous, mut record) = match existing {
            Some(entry) => {
                let path = dir.join(format!("{}.md", stem_of(entry)));
                let previous = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
                (
                    path,
                    Some(previous),
                    entry.remembered.clone().unwrap_or_default(),
                )
            }
            None => (
                free_path(&dir, &safe_file_stem(&name, "entry", 80)),
                None,
                Remembered::default(),
            ),
        };
        if record.created.is_empty() {
            record.created = now.to_string();
        }
        record.updated = now.to_string();
        record.conversation = source.conversation.clone();
        record.title = source.title.clone();
        record.document = source.document.clone();
        let content = format!(
            "---\nname: {name}\naliases: [{}]\n{}---\n{text}\n",
            aliases.join(", "),
            record.lines()
        );
        write(&path, &content)?;
        Ok(Remembering {
            remembered: id_of(Scope::Project, LIBRARY_FOLDER, &path),
            scope: Scope::Project,
            created: previous.is_none(),
            text: text.to_string(),
            previous,
            note: SAVED_NOTE,
        })
    }

    /// Undo of a remember call: deletes what it created, or puts back the
    /// file as it was before it updated it. Only ever touches what Textus
    /// AI wrote.
    pub fn undo(&self, id: &str, previous: Option<&str>) -> Result<(), String> {
        let loc = self.locate(id)?;
        let ours =
            |content: &str| loc.folder == MEMORY_FOLDER || Remembered::from_file(content).is_some();
        match previous {
            None => {
                let current = std::fs::read_to_string(&loc.path).map_err(|_| "GONE".to_string())?;
                if !ours(&current) {
                    return Err("NOT_REMEMBERED".into());
                }
                std::fs::remove_file(&loc.path).map_err(|e| e.to_string())
            }
            Some(previous) => {
                if !ours(previous) {
                    return Err("NOT_REMEMBERED".into());
                }
                write(&loc.path, previous)
            }
        }
    }

    /// Moves a memory to the other scope - its file to the other folder.
    /// Returns its new id.
    pub fn move_to(&self, id: &str, scope: Scope) -> Result<String, String> {
        let loc = self.locate(id)?;
        if loc.folder != MEMORY_FOLDER {
            return Err("Only memories move between personal and project.".into());
        }
        if loc.scope == scope {
            return Ok(id.to_string());
        }
        let dir = self.folder(scope, MEMORY_FOLDER).ok_or("NO_PROJECT")?;
        let content = std::fs::read_to_string(&loc.path).map_err(|_| "GONE".to_string())?;
        let target = free_path(&dir, &file_stem(&loc.path));
        write(&target, &content)?;
        std::fs::remove_file(&loc.path).map_err(|e| e.to_string())?;
        Ok(id_of(scope, MEMORY_FOLDER, &target))
    }

    /// Deletes a memory or a library entry (the Memory tab asks first).
    pub fn delete(&self, id: &str) -> Result<(), String> {
        let loc = self.locate(id)?;
        match std::fs::remove_file(&loc.path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    }
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

/// Whether `alias` is too short to stand for a name: one Chinese or
/// Japanese character (晚 for 林晚, which every 晚上 would match and send
/// her entry along), or one or two letters. The library sends an entry
/// whenever an alias appears in the text (project::relevant_library).
fn too_short_an_alias(alias: &str) -> bool {
    let chars = alias.chars().count();
    let unspaced = alias
        .chars()
        .any(|c| matches!(c, '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{9fff}'));
    chars == 0 || (unspaced && chars < 2) || (!unspaced && chars < 3)
}

/// What a duplicate check compares: the letters and digits, lowercased,
/// with full-width forms folded - "Keep it short." and "keep it short"
/// are one memory.
fn normalized(text: &str) -> String {
    text.chars()
        .map(crate::ai::tools::normalize_char)
        .flat_map(char::to_lowercase)
        .filter(|c| c.is_alphanumeric())
        .collect()
}

fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A short, readable file stem from a memory's first words.
fn memory_stem(text: &str) -> String {
    let stem = safe_file_stem(text, "memory", 48);
    let mut out = String::new();
    for c in stem.chars() {
        if !(c == '-' && out.ends_with('-')) {
            out.push(c);
        }
    }
    out.trim_matches('-').to_string()
}

/// `<dir>/<stem>.md`, or `<stem>-2.md` and on when that is taken.
fn free_path(dir: &Path, stem: &str) -> PathBuf {
    let mut path = dir.join(format!("{stem}.md"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem}-{n}.md"));
        n += 1;
    }
    path
}

fn file_stem(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn id_of(scope: Scope, folder: &str, path: &Path) -> String {
    format!("{}/{folder}/{}", scope.as_str(), file_stem(path))
}

fn write(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    crate::atomic::write_sync(path, content).map_err(|e| e.to_string())
}

/// Now, as `2026-10-18T09:30:00Z` (UTC).
fn now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    timestamp(secs)
}

fn timestamp(secs: u64) -> String {
    // Days to a civil date: Howard Hinnant's days_from_civil, inverted.
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3_600,
        rem % 3_600 / 60,
        rem % 60
    )
}

// ------------------------------------------------------------------- prompt

/// How Textus AI is told to use the remember tool - only when it has it.
const REMEMBER_INSTRUCTIONS: &str = "You can remember things for later conversations with the remember tool. Call it when the user states, or clearly shows by correcting you, something that should hold beyond this request: a requirement (\"always…\", \"never…\", \"from now on…\"), a preference about your replies and edits, or a trait of how they write (kind requirement, preference or style); or a fact about their work - a person, place or term and what is true of it (kind fact, with its name and any aliases; it goes into the project's library). A fact counts even when the user tells it to you in passing, as background to a request (\"Lin is the heroine, a lighthouse keeper - write the next scene\"): it holds for the rest of the work, so remember it before you go on. Don't remember a one-off request, what the document already says, your own suggestions, or anything private such as passwords, addresses or health details. Scope: something about this work (its characters, its terms, how this piece must be written) is project; the user's general habits and preferences are personal; with no project folder everything is personal. Before remembering, check what you already remember below: to change or correct one, call remember with `replaces` set to its id instead of adding another. Write each memory as one or a few plain sentences in the user's language, as an instruction to yourself (\"Use 「」 for quotations.\"). The ids in brackets are for the tool only - never show them to the user.";

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

// --------------------------------------------------------- revision choices

/// The log of accepted and rejected kinds of revision that suggestions are
/// learned from (`ChoiceLog` in src/ai/revision/revision-learning.ts,
/// which owns its shape and keeps it bounded). One hidden file beside the
/// personal memories - not a memory, so the Memory tab and the prompt never
/// list it, and it is never sent anywhere.
const CHOICES_FILE: &str = ".revision-choices.json";

/// A few hundred short entries fit many times over; past this a write is
/// refused rather than let the file grow.
const MAX_CHOICES_BYTES: usize = 64 * 1024;

impl MemoryDirs {
    fn choices_file(&self) -> Option<PathBuf> {
        self.folder(Scope::Personal, MEMORY_FOLDER)
            .map(|dir| dir.join(CHOICES_FILE))
    }

    /// The log, or None when there is none yet or it can't be read.
    fn read_choices(&self) -> Option<serde_json::Value> {
        let text = std::fs::read_to_string(self.choices_file()?).ok()?;
        serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .filter(serde_json::Value::is_object)
    }

    fn write_choices(&self, log: &serde_json::Value) -> Result<(), String> {
        if !log.is_object() {
            return Err("Not a revision choices log.".into());
        }
        let text = serde_json::to_string(log).map_err(|e| e.to_string())?;
        if text.len() > MAX_CHOICES_BYTES {
            return Err("The revision choices log is too large.".into());
        }
        let path = self
            .choices_file()
            .ok_or("Nowhere to keep it: the app's config folder isn't available.")?;
        write(&path, &text)
    }
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
