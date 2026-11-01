//! A paper kept in its project, `.textus/papers/<id>/`, so a stopped run
//! can resume and the user can read what the research found.

use super::{Dossier, Outline, Paper};
use crate::ai::workspace::project_dir;
use serde::{de::DeserializeOwned, Serialize};
use std::path::{Path, PathBuf};

const PAPERS_FOLDER: &str = "papers";
const PAPER_FILE: &str = "paper.json";
const DOSSIER_FILE: &str = "dossier.json";
const OUTLINE_FILE: &str = "outline.json";

/// Everything kept for one paper. A paper not yet researched has an empty
/// dossier; one not yet outlined, no outline.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct PaperFiles {
    pub paper: Paper,
    pub dossier: Dossier,
    pub outline: Option<Outline>,
}

/// A new paper's id: lowercase hex of the time, so ids sort by age.
pub(crate) fn new_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("{nanos:x}")
}

/// Letters and digits only, so an id names one folder under `papers/` and
/// can't climb out of it.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 32
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

/// `<root>/.textus/papers/<id>/`.
pub(crate) fn paper_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("Not a paper id: {id:?}"));
    }
    Ok(project_dir(root).join(PAPERS_FOLDER).join(id))
}

/// Writes the paper's files into `root`'s `.textus/`, each whole or not at
/// all, so a crash mid-save leaves the previous version.
pub(crate) fn save(root: &Path, files: &PaperFiles) -> Result<(), String> {
    let dir = paper_dir(root, &files.paper.id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_json(&dir.join(PAPER_FILE), &files.paper)?;
    write_json(&dir.join(DOSSIER_FILE), &files.dossier)?;
    if let Some(outline) = &files.outline {
        write_json(&dir.join(OUTLINE_FILE), outline)?;
    }
    Ok(())
}

/// Section `index`'s draft, as `section-<index + 1>.md` beside the paper,
/// for review and for a run that stopped to go on from.
pub(crate) fn save_section(
    root: &Path,
    id: &str,
    index: usize,
    markdown: &str,
) -> Result<(), String> {
    let dir = paper_dir(root, id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    crate::atomic::write_sync(
        &dir.join(format!("section-{}.md", index + 1)),
        markdown.as_bytes(),
    )
    .map_err(|e| e.to_string())
}

/// Every section draft kept beside paper `id`, taken away.
pub(crate) fn clear_sections(root: &Path, id: &str) -> Result<(), String> {
    let dir = paper_dir(root, id)?;
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("section-") && name.ends_with(".md") {
            std::fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Section `index`'s draft, if it was written.
pub(crate) fn load_section(root: &Path, id: &str, index: usize) -> Result<Option<String>, String> {
    let path = paper_dir(root, id)?.join(format!("section-{}.md", index + 1));
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// The paper `id` kept in `root`'s `.textus/`.
pub(crate) fn load(root: &Path, id: &str) -> Result<PaperFiles, String> {
    let dir = paper_dir(root, id)?;
    let paper: Paper = read_json(&dir.join(PAPER_FILE))?
        .ok_or_else(|| format!("No paper {id} in this project"))?;
    Ok(PaperFiles {
        paper,
        dossier: read_json(&dir.join(DOSSIER_FILE))?.unwrap_or_default(),
        outline: read_json(&dir.join(OUTLINE_FILE))?,
    })
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    crate::atomic::write_sync(path, json).map_err(|e| e.to_string())
}

/// None when the file isn't there; an error when it is but can't be read.
fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| format!("{}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
