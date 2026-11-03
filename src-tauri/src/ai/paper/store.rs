//! A paper kept with its project's data in Textus's config folder
//! (ai::project_data), `papers/<id>/`, so a stopped run can resume and the
//! user can read what the research found.

use super::{Dossier, Material, Outline, Paper};
use crate::ai::workspace::project_dir;
use serde::{de::DeserializeOwned, Serialize};
use std::path::{Path, PathBuf};

const PAPERS_FOLDER: &str = "papers";
const PAPER_FILE: &str = "paper.json";
const DOSSIER_FILE: &str = "dossier.json";
const OUTLINE_FILE: &str = "outline.json";
const MATERIALS_FILE: &str = "materials.json";

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

/// `<base>/papers/<id>/`.
pub(crate) fn paper_dir(base: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("Not a paper id: {id:?}"));
    }
    Ok(base.join(PAPERS_FOLDER).join(id))
}

/// The folder paper `id` is kept under: its project's data folder, or the
/// scratch space while there is no project folder. A paper begun in scratch
/// moves to the project the first time it is asked for there, and one an
/// older Textus kept in the project's `.textus/papers/` moves out of it.
pub(crate) fn paper_root(
    app: &tauri::AppHandle,
    doc_path: Option<&str>,
    workspace_root: Option<&str>,
    id: Option<&str>,
) -> Result<PathBuf, String> {
    let project = crate::ai::workspace::project_root(doc_path, workspace_root);
    let base = project.map(|root| match crate::ai::workspace::global_agent_dir(app) {
        Ok(global) => {
            crate::ai::project_data::adopt(&global, &root, PAPERS_FOLDER);
            crate::ai::project_data::dir(&global, &root)
        }
        Err(_) => project_dir(&root),
    });
    root_in(&crate::ai::scratch::research_dir()?, base, id)
}

/// [`paper_root`] with the scratch folder given, for tests.
pub(crate) fn root_in(
    scratch: &Path,
    project: Option<PathBuf>,
    id: Option<&str>,
) -> Result<PathBuf, String> {
    let Some(root) = project else {
        return Ok(scratch.to_path_buf());
    };
    if let Some(id) = id {
        let from = paper_dir(scratch, id)?;
        let to = paper_dir(&root, id)?;
        if from.is_dir() && !to.exists() {
            move_paper(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(root)
}

/// A paper's folder moved whole; copied file by file where it can't be
/// renamed (the temporary folder on another volume). Its files are flat.
fn move_paper(from: &Path, to: &Path) -> std::io::Result<()> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        std::fs::copy(entry.path(), to.join(entry.file_name()))?;
    }
    // The copy is whole; what is left behind is only clutter in the
    // temporary folder.
    for entry in std::fs::read_dir(from)?.flatten() {
        let _ = std::fs::remove_file(entry.path());
    }
    let _ = std::fs::remove_dir(from);
    Ok(())
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

/// The files attached to paper `id`'s request, kept for a run that goes on.
pub(crate) fn save_materials(root: &Path, id: &str, materials: &[Material]) -> Result<(), String> {
    let dir = paper_dir(root, id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_json(&dir.join(MATERIALS_FILE), &materials)
}

/// What [`save_materials`] kept; none when nothing was attached.
pub(crate) fn load_materials(root: &Path, id: &str) -> Result<Vec<Material>, String> {
    Ok(read_json(&paper_dir(root, id)?.join(MATERIALS_FILE))?.unwrap_or_default())
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
