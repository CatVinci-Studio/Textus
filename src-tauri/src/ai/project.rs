//! The project folder seen as writing material: walking, reading and searching
//! it safely, and the `.textus/` style profile and library. A library entry
//! goes to the model only when `always`, or when its name or an alias comes up.

use crate::ai::memory::Remembered;
use crate::ai::workspace::{project_dir, project_file, strip_html_comments, WORKSPACE_DIR_NAME};
use base64::Engine;
use serde::Serialize;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use unicode_normalization::UnicodeNormalization;

mod files;
pub(crate) use files::*;
mod search;
pub(crate) use search::*;
mod library;
pub(crate) use library::*;
mod style;
pub(crate) use style::*;
mod references;
pub(crate) use references::*;

/// Most library text one request carries, in characters (not bytes, so CJK
/// gets as much as English).
pub(crate) const MAX_LIBRARY_CHARS: usize = 8_000;

#[cfg(test)]
mod tests;

// ------------------------------------------------------------------ commands

fn project_root(doc_path: Option<&str>, workspace_root: Option<&str>) -> Result<PathBuf, String> {
    crate::ai::workspace::project_root(doc_path, workspace_root)
        .ok_or_else(|| "NO_PROJECT".to_string())
}

/// The project's text files, for the composer's @-mention picker.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn list_project_files(
    doc_path: Option<String>,
    workspace_root: Option<String>,
) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_root(doc_path.as_deref(), workspace_root.as_deref())
            .map(|root| walk_text_files(&root).files)
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default()
}

/// One project file's text, for an @-mention, under the same safety rules as
/// the agent's read_file.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn read_project_file(
    doc_path: Option<String>,
    workspace_root: Option<String>,
    path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = project_root(doc_path.as_deref(), workspace_root.as_deref())?;
        read_text(&root, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The Memory tab's "used" marks: what the last request for the document
/// carried, or before one, what the document's text brings in by itself.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn library_use(
    doc_path: Option<String>,
    workspace_root: Option<String>,
    document: String,
) -> LibraryUse {
    if let Some(sent) = LAST_SENT
        .lock()
        .ok()
        .and_then(|sent| sent.get(doc_path.as_deref().unwrap_or_default()).cloned())
    {
        return sent;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(root) = project_root(doc_path.as_deref(), workspace_root.as_deref()) else {
            return LibraryUse::default();
        };
        let library = read_library(&root);
        let document = crate::ai::doc_blocks::Document::from_markdown(&document);
        let context = crate::ai::agent::document_section(&document, true, None);
        LibraryUse::of(&pick_library(&library, &context), false)
    })
    .await
    .unwrap_or_default()
}

/// Creates `.textus/<rel>` with `template` unless it already exists, and
/// returns its absolute path.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn ensure_project_file(
    doc_path: Option<String>,
    workspace_root: Option<String>,
    rel: String,
    template: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = project_root(doc_path.as_deref(), workspace_root.as_deref())?;
        let rel = rel.trim_start_matches(['/', '\\']);
        if rel
            .split(['/', '\\'])
            .any(|part| part == ".." || part.is_empty())
        {
            return Err("Invalid file name.".to_string());
        }
        let path = project_dir(&root).join(rel);
        if !path.exists() {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            crate::atomic::write_sync(&path, template).map_err(|e| e.to_string())?;
        }
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Multi-select picker for the writing samples "Learn my style" analyses.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn pick_text_files(window: tauri::WebviewWindow) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::commands::fs::window_file_dialog(&window)
            .add_filter("Text", &["md", "markdown", "txt"])
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|p| p.to_string())
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// "Learn my style": analyses the picked samples and writes `.textus/style.md`
/// (keeping the previous one as style.previous.md). Returns its path, which the
/// frontend opens for review.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn learn_style(
    app: tauri::AppHandle,
    provider: String,
    model: Option<String>,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    files: Vec<String>,
) -> Result<String, String> {
    crate::ai::ensure_on(&app)?;
    let (root, samples) = {
        tauri::async_runtime::spawn_blocking(move || -> Result<(PathBuf, String), String> {
            let root = project_root(doc_path.as_deref(), workspace_root.as_deref())?;
            let samples = style_samples(&files)?;
            Ok((root, samples))
        })
        .await
        .map_err(|e| e.to_string())??
    };
    let profile = crate::ai::client::call(
        &app,
        &provider,
        style_instructions(),
        samples,
        model.as_deref(),
    )
    .await?;
    let profile = profile.trim();
    if profile.is_empty() {
        return Err("The model returned an empty profile.".to_string());
    }
    let path = style_path(&root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if let Some(previous) = project_file(&root, "style.md") {
        let _ = std::fs::copy(&previous, path.with_file_name("style.previous.md"));
    }
    crate::atomic::write(&path, format!("{profile}\n"))
        .await
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
