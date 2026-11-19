//! Folder conventions of apps the core doesn't read, read by plugins
//! (`files.registerConventionReader`). The core only looks for each
//! reader's marker file; the plugin is handed that file's text once and
//! answers what the app sets, which is kept here until the file changes.
//! What a plugin finds is only ever offered, like any other app's settings.

use super::{Conventions, Daily, Setting, Source};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

/// Apps the core names itself; no plugin may answer as one of them.
const CORE_APPS: [&str; 13] = [
    "textus",
    "typora",
    "obsidian",
    "logseq",
    "dendron",
    "foam",
    "vscode",
    "mkdocs",
    "hugo",
    "docusaurus",
    "jekyll",
    "quarto",
    "git",
];
/// A marker file larger than this isn't a settings file.
const MAX_MARKER: u64 = 512 * 1024;

/// A plugin's reader: its app (`<plugin id>#<reader id>`) and the file,
/// from a folder, that says the app keeps the folder.
#[derive(Deserialize, Clone, Debug)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PluginReader {
    pub app: String,
    pub marker: String,
    /// The app keeps notes linked by name, found from its folder.
    #[serde(default)]
    pub notes: bool,
}

/// A marker file no plugin has answered yet.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PendingRead {
    pub app: String,
    pub root: String,
    pub text: String,
}

/// Periodic notes as a plugin gives them: the folder from the app's root.
#[derive(Deserialize, Clone, Debug, Default)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FoundNotes {
    pub folder: String,
    pub format: String,
    pub template: Option<String>,
}

/// What a plugin's reader says the app sets; folders from the app's root.
#[derive(Deserialize, Clone, Debug, Default)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub link_style: Option<String>,
    pub link_path: Option<String>,
    pub update_links: Option<String>,
    pub attachments: Option<String>,
    pub soft_breaks: Option<bool>,
    pub templates: Option<String>,
    pub daily: Option<FoundNotes>,
    pub new_notes: Option<String>,
    #[serde(default)]
    pub ignore: Vec<String>,
}

/// Each window's readers, by window.
static READERS: Mutex<Option<HashMap<String, Vec<PluginReader>>>> = Mutex::new(None);
/// Answers by app and root, with the marker text's hash they were read from.
type Answers = HashMap<(String, PathBuf), (u64, Conventions)>;
static ANSWERS: Mutex<Option<Answers>> = Mutex::new(None);

fn readers() -> Vec<PluginReader> {
    let Ok(all) = READERS.lock() else {
        return vec![];
    };
    let mut out: Vec<PluginReader> = vec![];
    for reader in all.iter().flat_map(|m| m.values()).flatten() {
        if !out.iter().any(|r| r.app == reader.app) {
            out.push(reader.clone());
        }
    }
    out
}

/// Whether `rel` stays inside the folder it is read from.
fn inside(rel: &str) -> bool {
    let path = Path::new(rel);
    !rel.trim().is_empty()
        && path
            .components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
}

fn hash(text: &str) -> u64 {
    let mut h = DefaultHasher::new();
    text.hash(&mut h);
    h.finish()
}

/// Sets `window`'s readers, dropping answers no reader gives any more.
pub(crate) fn set_readers(window: &str, list: Vec<PluginReader>) {
    let list: Vec<PluginReader> = list
        .into_iter()
        .filter(|r| r.app.contains('#') && !CORE_APPS.contains(&r.app.as_str()))
        .filter(|r| inside(&r.marker))
        .collect();
    if let Ok(mut all) = READERS.lock() {
        all.get_or_insert_with(HashMap::new)
            .insert(window.to_string(), list);
    }
    let apps: Vec<String> = readers().into_iter().map(|r| r.app).collect();
    if let Ok(mut answers) = ANSWERS.lock() {
        if let Some(map) = answers.as_mut() {
            map.retain(|(app, _), _| apps.contains(app));
        }
    }
    super::forget();
}

/// The marker's text, when `dir` holds `reader`'s marker.
fn marker_text(dir: &Path, reader: &PluginReader) -> Option<String> {
    let file = dir.join(&reader.marker);
    let meta = std::fs::metadata(&file).ok()?;
    if !meta.is_file() || meta.len() > MAX_MARKER {
        return None;
    }
    std::fs::read_to_string(file).ok()
}

/// The apps plugins read that keep `dir`, each as answered, or with no
/// settings yet while its plugin hasn't answered.
pub(super) fn at(dir: &Path) -> Vec<Conventions> {
    readers()
        .iter()
        .filter_map(|reader| {
            let text = marker_text(dir, reader)?;
            let key = (reader.app.clone(), dir.to_path_buf());
            let answered = ANSWERS
                .lock()
                .ok()
                .and_then(|a| a.as_ref()?.get(&key).cloned())
                .filter(|(h, _)| *h == hash(&text))
                .map(|(_, c)| c);
            Some(answered.unwrap_or_else(|| bare(reader, dir)))
        })
        .collect()
}

fn bare(reader: &PluginReader, dir: &Path) -> Conventions {
    Conventions {
        sources: vec![Source {
            app: reader.app.clone(),
            root: dir.to_string_lossy().into_owned(),
            notes: reader.notes,
        }],
        ..Default::default()
    }
}

/// Marker files in `path`'s folders that no plugin has answered for.
pub(crate) fn pending(path: &Path) -> Vec<PendingRead> {
    let readers = readers();
    if readers.is_empty() {
        return vec![];
    }
    let start = if path.is_dir() {
        path
    } else {
        path.parent().unwrap_or(path)
    };
    let answers = ANSWERS
        .lock()
        .ok()
        .and_then(|a| a.clone())
        .unwrap_or_default();
    let mut out = vec![];
    for dir in start.ancestors().take(super::MAX_ASCENT) {
        for reader in &readers {
            let Some(text) = marker_text(dir, reader) else {
                continue;
            };
            let key = (reader.app.clone(), dir.to_path_buf());
            if answers.get(&key).is_some_and(|(h, _)| *h == hash(&text)) {
                continue;
            }
            out.push(PendingRead {
                app: reader.app.clone(),
                root: dir.to_string_lossy().into_owned(),
                text,
            });
        }
    }
    out
}

/// One of the given values, else nothing.
fn one_of(value: Option<String>, allowed: &[&str]) -> Option<String> {
    value.filter(|v| allowed.contains(&v.as_str()))
}

/// A plugin's answer as the app's conventions at `root`: unknown values and
/// folders outside the root are left out.
fn conventions_of(reader: &PluginReader, root: &Path, found: Found) -> Conventions {
    let app = reader.app.as_str();
    fn at<T>(app: &str, root: &Path, value: T) -> Option<Setting<T>> {
        Some(Setting {
            value,
            app: app.to_string(),
            root: root.to_string_lossy().into_owned(),
        })
    }
    let folder = |rel: String| {
        let rel = rel.trim().trim_matches('/').to_string();
        if rel.is_empty() || rel == "." {
            return Some(root.to_string_lossy().into_owned());
        }
        inside(&rel).then(|| root.join(rel).to_string_lossy().into_owned())
    };
    let mut out = bare(reader, root);
    out.link_style = one_of(found.link_style, &["wiki", "markdown"]).and_then(|v| at(app, root, v));
    out.link_path = one_of(found.link_path, &["shortest", "relative", "absolute"])
        .and_then(|v| at(app, root, v));
    out.update_links =
        one_of(found.update_links, &["always", "ask", "never"]).and_then(|v| at(app, root, v));
    out.attachments = found
        .attachments
        .filter(|a| {
            let a = a.trim().trim_start_matches("./");
            a.is_empty() || a == "/" || a == "." || inside(a)
        })
        .and_then(|v| at(app, root, v));
    out.soft_breaks = found.soft_breaks.and_then(|v| at(app, root, v));
    out.templates = found
        .templates
        .and_then(folder)
        .and_then(|v| at(app, root, v));
    out.new_notes = found
        .new_notes
        .filter(|n| n.trim().is_empty() || inside(n.trim().trim_start_matches("./")))
        .and_then(|v| at(app, root, v));
    out.daily = found.daily.and_then(|d| {
        let template = match d.template {
            Some(t) => Some(folder(t)?),
            None => None,
        };
        at(
            app,
            root,
            Daily {
                folder: folder(d.folder)?,
                format: d.format,
                template,
            },
        )
    });
    out.ignore = found.ignore.into_iter().filter(|p| inside(p)).collect();
    out
}

/// Keeps a plugin's answer for the marker `text` at `root`; nothing found
/// keeps the app as found, with no settings.
pub(crate) fn answer(app: &str, root: &Path, text: &str, found: Option<Found>) {
    let Some(reader) = readers().into_iter().find(|r| r.app == app) else {
        return;
    };
    let conventions = match found {
        Some(found) => conventions_of(&reader, root, found),
        None => bare(&reader, root),
    };
    if let Ok(mut answers) = ANSWERS.lock() {
        let map = answers.get_or_insert_with(HashMap::new);
        if map.len() > 256 {
            map.clear();
        }
        map.insert(
            (app.to_string(), root.to_path_buf()),
            (hash(text), conventions),
        );
    }
    super::forget();
}

/// The plugins' convention readers in this window.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn conventions_readers(window: tauri::Window, readers: Vec<PluginReader>) {
    set_readers(window.label(), readers);
}

/// Marker files above `path` a plugin should read.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn conventions_pending(path: String) -> Vec<PendingRead> {
    tauri::async_runtime::spawn_blocking(move || pending(Path::new(&path)))
        .await
        .unwrap_or_default()
}

/// A plugin's answer for the marker it was handed.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn conventions_answer(app: String, root: String, text: String, found: Option<Found>) {
    answer(&app, Path::new(&root), &text, found);
}
