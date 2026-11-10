//! General mode's changes to the folder's other files: write_file and
//! edit_file write straight to disk, each change kept (the file before and
//! after) in the conversation's scratch folder, so a reply's changes undo
//! and redo together. With changes as revisions (ask_first), a change to a
//! file is only kept - the editor shows it as revisions in that file - and a
//! file made is made, marked as the AI's until the user keeps it.

use crate::ai::project::{file_kind, is_hidden, FileKind};
use crate::ai::tools::{Access, Run, Tool, EDITING_MODES};
use aicompat::agent::{ToolCall, ToolOutput, ToolSpec};
use serde_json::json;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

pub(crate) const WRITE_FILE_TOOL_NAME: &str = "write_file";
pub(crate) const EDIT_FILE_TOOL_NAME: &str = "edit_file";

/// The most a written file may hold, as read_file's limit.
const MAX_BYTES: usize = 2 * 1024 * 1024;

/// One change to one file.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub id: String,
    /// The file, from the folder.
    pub path: String,
    /// The file's whole path.
    pub file: String,
    /// The file as it was; None where the change made it.
    pub before: Option<String>,
    pub after: String,
    /// On disk now: false while waiting to be applied, or once undone.
    pub applied: bool,
    /// Made while changes land as revisions: kept for review, a file made
    /// waiting to be kept.
    #[serde(default)]
    pub revision: bool,
}

/// Where one request's file changes go.
pub struct FileEdits {
    /// The folder, canonical: what "inside it" is checked against.
    root: PathBuf,
    /// The folder as the editor names it: the files' paths are written from
    /// it, so the tree, its tabs and the stores find them (a folder under a
    /// link keeps its own spelling).
    named: PathBuf,
    record: PathBuf,
    /// The document open in the editor: its changes are proposals.
    open_document: Option<PathBuf>,
    ask_first: bool,
    /// This request's changes, in order: a file changed twice reads its own
    /// earlier change.
    made: Mutex<Vec<FileChange>>,
}

impl FileEdits {
    /// The changes for a request in `root`, kept for `conversation`; None
    /// without either.
    pub fn new(
        root: Option<&Path>,
        conversation: Option<&str>,
        open_document: Option<&Path>,
        ask_first: bool,
    ) -> Option<Self> {
        let named = root?.to_path_buf();
        let root = named.canonicalize().ok()?;
        let record = crate::ai::scratch::conversation_dir(conversation?)
            .ok()?
            .join("changes");
        Some(Self {
            root,
            named,
            record,
            open_document: open_document.and_then(|p| p.canonicalize().ok()),
            ask_first,
            made: Mutex::new(Vec::new()),
        })
    }

    /// write_file and edit_file, run against these changes.
    pub fn tools(&self) -> Vec<Tool<'_>> {
        vec![
            Tool {
                spec: write_spec(),
                access: Access::ProposesInItsCall,
                modes: EDITING_MODES,
                run: Run::Async(Box::new(move |call| {
                    Box::pin(async move { self.run(&call, write_file) })
                })),
            },
            Tool {
                spec: edit_spec(),
                access: Access::ProposesInItsCall,
                modes: EDITING_MODES,
                run: Run::Async(Box::new(move |call| {
                    Box::pin(async move { self.run(&call, edit_file) })
                })),
            },
        ]
    }

    /// Makes one change: its new text from `change`, given the file's text
    /// now; recorded in the call as `change`.
    fn run(
        &self,
        call: &ToolCall,
        change: fn(&serde_json::Value, Option<&str>) -> Result<String, String>,
    ) -> ToolOutput {
        let mut args: serde_json::Value = serde_json::from_str(&call.arguments).unwrap_or_default();
        let rel = args["path"].as_str().unwrap_or("").to_string();
        let made = (|| {
            let file = self.target(&rel)?;
            let now = self.current(&file)?;
            // Made in this reply: it waits as a whole to be kept, its later
            // changes written in with it.
            let made_now = self
                .made
                .lock()
                .unwrap()
                .iter()
                .any(|c| c.file == file.to_string_lossy() && c.before.is_none());
            let after = change(&args, now.as_deref())?;
            if after.len() > MAX_BYTES {
                return Err("That is too long for one file (2 MB at most).".to_string());
            }
            if now.as_deref() == Some(after.as_str()) {
                return Err(format!("`{rel}` already reads that way: nothing changed."));
            }
            let change = FileChange {
                id: change_id(),
                path: rel.trim().trim_start_matches(['@', '/']).to_string(),
                file: file.to_string_lossy().into_owned(),
                // A file it makes is made even as a revision: it waits, marked
                // as the AI's, for the user to keep or discard it.
                applied: !self.ask_first || now.is_none() || made_now,
                before: now,
                after,
                revision: self.ask_first,
            };
            if change.applied {
                write(&file, &change.after)?;
            }
            // Unrecorded, it couldn't be undone: put the file back.
            if let Err(problem) = save(&self.record, &change) {
                if change.applied {
                    match &change.before {
                        Some(before) => write(&file, before)?,
                        None => {
                            let _ = std::fs::remove_file(&file);
                        }
                    }
                }
                return Err(problem);
            }
            self.made.lock().unwrap().push(change.clone());
            Ok(change)
        })();
        match made {
            Ok(change) => {
                args["change"] = json!(change.id);
                let made = change.before.is_none();
                let text = match (change.applied, made, self.ask_first) {
                    (true, true, true) => format!(
                        "Created `{}` - marked as yours until the user keeps or discards it.",
                        change.path
                    ),
                    (true, true, false) => {
                        format!("Created `{}` - the user can undo it.", change.path)
                    }
                    (true, false, _) => {
                        format!("Changed `{}` - the user can undo it.", change.path)
                    }
                    (false, _, _) => format!(
                        "Kept `{}` as a revision in that file for the user to accept or reject: it isn't on disk until they accept it. Later changes to it in this reply build on this one; from your next reply on, read_file shows it with your revision.",
                        change.path
                    ),
                };
                ToolOutput {
                    text,
                    call_arguments: Some(args.to_string()),
                    ..ToolOutput::default()
                }
            }
            Err(problem) => problem.into(),
        }
    }

    /// The file `rel` names, inside the folder, not hidden, a text file, and
    /// not the open document.
    fn target(&self, rel: &str) -> Result<PathBuf, String> {
        let rel = rel.trim().trim_start_matches(['@', '/']);
        if rel.is_empty() {
            return Err("`path` is required: the file, from the folder.".to_string());
        }
        let relative = Path::new(rel);
        let mut inside = PathBuf::new();
        for part in relative.components() {
            match part {
                Component::Normal(name) if is_hidden(&name.to_string_lossy()) => {
                    return Err("Files and folders whose names start with \".\" (.git, .textus) aren't changed.".to_string())
                }
                Component::Normal(name) => inside.push(name),
                Component::CurDir => {}
                _ => return Err("Give the path from the folder, without `..`.".to_string()),
            }
        }
        if !matches!(file_kind(relative), Some(FileKind::Text)) {
            return Err(format!("`{rel}` isn't a text file; only text files (Markdown, plain text and the like) are written."));
        }
        let file = self.named.join(&inside);
        // A link inside the folder may point out of it.
        let mut existing = file.as_path();
        while !existing.exists() {
            existing = existing.parent().unwrap_or(&self.named);
        }
        let real = existing.canonicalize().map_err(|e| e.to_string())?;
        if !real.starts_with(&self.root) {
            return Err(
                "That path leads outside the folder - only files inside it are changed."
                    .to_string(),
            );
        }
        let real_file = file.canonicalize().unwrap_or_else(|_| file.clone());
        if self.open_document.as_deref() == Some(real_file.as_path()) {
            return Err("That is the open document: change it with propose_edit.".to_string());
        }
        Ok(file)
    }

    /// The file's text as this request left it: its last kept change, else
    /// a revision kept for it earlier, else the disk; None for a file not
    /// there yet.
    fn current(&self, file: &Path) -> Result<Option<String>, String> {
        let name = file.to_string_lossy();
        if let Some(last) = self
            .made
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|c| c.file == name)
        {
            return Ok(Some(last.after.clone()));
        }
        // A change kept as a revision before, not yet placed: this builds on
        // it. Written straight in, a revision left waiting is the user's to
        // decide, never written along with this.
        if let Some(waiting) = crate::ai::kept_proposals::pending_text(file) {
            if self.ask_first {
                return Ok(Some(waiting));
            }
            return Err(format!("A revision of yours to `{}` still waits for the user to accept or reject it; tell them what you would change instead of changing it now.", file.display()));
        }
        // Its revisions placed in the editor and still undecided: a change
        // now would land under them.
        if crate::ai::kept_proposals::has_undecided(file) {
            return Err("The user is still deciding on your revisions in that file; tell them what else you would change instead of changing it now.".to_string());
        }
        if !file.exists() {
            return Ok(None);
        }
        if file.is_dir() {
            return Err("That is a folder, not a file.".to_string());
        }
        let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_BYTES {
            return Err("That file is too large to change (2 MB at most).".to_string());
        }
        String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| "That file isn't UTF-8 text, so it isn't changed.".to_string())
    }
}

fn write_spec() -> ToolSpec {
    ToolSpec {
        name: WRITE_FILE_TOOL_NAME.into(),
        description: "Create a file in the folder, or replace one's whole text. For a few changes to a file that exists, edit_file is cheaper and safer. Not for the open document - propose_edit changes that. Work across several files: first say in a line or two which files you will change and how, then make the changes without waiting for an answer.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "The file, from the folder, e.g. `chapters/03.md`; folders are made as needed" },
                "content": { "type": "string", "description": "The file's whole new text" }
            },
            "required": ["path", "content"],
        }),
    }
}

fn edit_spec() -> ToolSpec {
    ToolSpec {
        name: EDIT_FILE_TOOL_NAME.into(),
        description: "Change part of a file in the folder: `old` must appear in it exactly once, verbatim (read_file it first), and becomes `new`. Several changes to one file are several calls. Not for the open document - propose_edit changes that.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "The file, from the folder" },
                "old": { "type": "string", "description": "The text to replace, verbatim, enough of it to be unique" },
                "new": { "type": "string", "description": "What it becomes; empty deletes it" }
            },
            "required": ["path", "old", "new"],
        }),
    }
}

fn write_file(args: &serde_json::Value, _now: Option<&str>) -> Result<String, String> {
    args["content"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "`content` is required: the file's whole new text.".to_string())
}

fn edit_file(args: &serde_json::Value, now: Option<&str>) -> Result<String, String> {
    let Some(now) = now else {
        return Err("That file doesn't exist yet: create it with write_file.".to_string());
    };
    let old = args["old"].as_str().unwrap_or("");
    let Some(new) = args["new"].as_str() else {
        return Err("`new` is required: what the text becomes (\"\" to delete it).".to_string());
    };
    if old.is_empty() {
        return Err("`old` is required: the text to replace, verbatim.".to_string());
    }
    match now.matches(old).count() {
        1 => Ok(now.replacen(old, new, 1)),
        0 => Err(
            "`old` isn't in the file as written - read_file it and copy the text exactly."
                .to_string(),
        ),
        n => Err(format!(
            "`old` appears {n} times; include more of the text around it so it is unique."
        )),
    }
}

fn change_id() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{now:x}-{:x}", NEXT.fetch_add(1, Ordering::Relaxed))
}

fn write(file: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    crate::atomic::write_sync(file, text).map_err(|e| e.to_string())
}

fn save(record: &Path, change: &FileChange) -> Result<(), String> {
    std::fs::create_dir_all(record).map_err(|e| e.to_string())?;
    let text = serde_json::to_string(change).map_err(|e| e.to_string())?;
    crate::atomic::write_sync(&record.join(format!("{}.json", change.id)), text)
        .map_err(|e| e.to_string())
}

fn load(record: &Path, id: &str) -> Result<FileChange, String> {
    if !crate::ai::scratch::valid_id(id) {
        return Err("Unknown change.".to_string());
    }
    let text = std::fs::read_to_string(record.join(format!("{id}.json")))
        .map_err(|_| "That change is no longer kept.".to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

fn record_of(conversation: &str) -> Result<PathBuf, String> {
    Ok(crate::ai::scratch::conversation_dir(conversation)?.join("changes"))
}

/// Puts `change` on disk (`on`) or takes it off: written, or the file
/// back as it was - one the change made moved to the Trash, never
/// deleted. Refused where the file no longer reads as the change left it.
fn set(record: &Path, change: &mut FileChange, on: bool) -> Result<(), String> {
    if change.applied == on {
        return Ok(());
    }
    let file = Path::new(&change.file);
    let now = std::fs::read_to_string(file).ok();
    let expected = if on {
        change.before.clone()
    } else {
        Some(change.after.clone())
    };
    if now != expected {
        return Err(format!(
            "`{}` was changed since, so it is left as it is.",
            change.path
        ));
    }
    match (on, &change.before) {
        (true, _) => write(file, &change.after)?,
        (false, Some(before)) => write(file, before)?,
        // A file it made, discarded: to the Trash, where the user can get it
        // back; set aside in the record where there is none.
        (false, None) => {
            if trash::delete(file).is_err() {
                set_aside(file, &record.join(format!("{}.removed", change.id)))?
            }
        }
    }
    change.applied = on;
    Ok(())
}

/// Moves `file` to `to`; across disks (a scratch folder in memory), a copy
/// kept there first.
fn set_aside(file: &Path, to: &Path) -> Result<(), String> {
    if std::fs::rename(file, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(file, to).map_err(|e| e.to_string())?;
    std::fs::remove_file(file).map_err(|e| e.to_string())
}

/// The changes `ids` of `conversation`, as kept.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn ai_file_changes(conversation: String, ids: Vec<String>) -> Result<Vec<FileChange>, String> {
    let record = record_of(&conversation)?;
    Ok(ids.iter().filter_map(|id| load(&record, id).ok()).collect())
}

/// Puts the changes `ids` on disk (`on`: apply, redo) or takes them off
/// (undo), the later first when undoing. Each that can't be is left, and
/// the answer says why; the changes come back as they now are.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn ai_set_file_changes(
    conversation: String,
    ids: Vec<String>,
    on: bool,
) -> Result<(Vec<FileChange>, Vec<String>), String> {
    let record = record_of(&conversation)?;
    let mut changes: Vec<FileChange> = ids.iter().filter_map(|id| load(&record, id).ok()).collect();
    let mut problems = Vec::new();
    let order: Vec<usize> = if on {
        (0..changes.len()).collect()
    } else {
        (0..changes.len()).rev().collect()
    };
    for i in order {
        match set(&record, &mut changes[i], on) {
            Ok(()) => save(&record, &changes[i])?,
            Err(problem) => problems.push(problem),
        }
    }
    Ok((changes, problems))
}

#[cfg(test)]
#[path = "file_changes/tests.rs"]
mod tests;
