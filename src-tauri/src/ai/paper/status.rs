//! What the card asks of a kept paper: how far it came, to go on from
//! there, and the outline the user edited, kept for drafting.

use super::GenreForm;
use super::{clear_sections, load, load_section, outline, save, Outline, Paper, PaperStage};
use serde::Serialize;

/// The outline as the user edited it on the card, kept for drafting. Notes
/// it names that the dossier doesn't have are dropped; it needs a section,
/// and every section a title.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn ai_paper_save_outline(
    doc_path: Option<String>,
    workspace_root: Option<String>,
    id: String,
    outline: Outline,
) -> Result<Outline, String> {
    let root = crate::ai::workspace::project_root(doc_path.as_deref(), workspace_root.as_deref())
        .ok_or_else(|| "NO_PROJECT".to_string())?;
    let mut files = load(&root, &id)?;
    let outline = outline::as_edited(outline, &files.dossier)?;
    files.outline = Some(outline.clone());
    files.paper.stage = PaperStage::Drafting;
    // Sections drafted from an outline before this one aren't this one's.
    clear_sections(&root, &id)?;
    save(&root, &files)?;
    Ok(outline)
}

/// How far a kept paper has come: what its card offers to go on with.
#[derive(Serialize, Debug)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PaperProgress {
    pub paper: Paper,
    pub outline: Option<Outline>,
    /// How many of the outline's sections are written.
    pub drafted: u32,
    pub form: GenreForm,
}

/// Paper `id` as it was kept, for its card to go on from where it stopped.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn ai_paper_status(
    doc_path: Option<String>,
    workspace_root: Option<String>,
    id: String,
) -> Result<PaperProgress, String> {
    let root = crate::ai::workspace::project_root(doc_path.as_deref(), workspace_root.as_deref())
        .ok_or_else(|| "NO_PROJECT".to_string())?;
    progress(&root, &id)
}

pub(crate) fn progress(root: &std::path::Path, id: &str) -> Result<PaperProgress, String> {
    let files = load(root, id)?;
    let sections = files.outline.as_ref().map_or(0, |o| o.sections.len());
    let mut drafted = 0;
    for i in 0..sections {
        drafted += load_section(root, id, i)?.is_some() as u32;
    }
    Ok(PaperProgress {
        form: files.paper.genre.form(),
        paper: files.paper,
        outline: files.outline,
        drafted,
    })
}
