//! What a folder says about how it is written, whichever app made it: how
//! links are written and where `/` points, where pictures go, whether a
//! single newline is a line break, where templates, daily notes and new notes
//! live. Read only, never written; worked out once per folder and kept a
//! moment. The core follows the link, picture and line-break fields; plugins
//! read the rest through `files.conventions` instead of parsing other apps'
//! settings themselves.

mod readers;
mod text;

use crate::commands::fs::ImageFolder;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How far up from a document its folders' apps are looked for.
const MAX_ASCENT: usize = 32;
/// How long a folder's answer is kept: settings change rarely, and a
/// paste or a link asks many times in a row.
const FRESH: Duration = Duration::from_secs(3);

/// One setting and where it came from.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Setting<T> {
    pub value: T,
    /// "textus", "typora", "obsidian", "logseq", "dendron", "foam",
    /// "vscode", "mkdocs", "hugo", "docusaurus", "jekyll", "quarto", "git".
    pub app: String,
    /// The folder whose settings these are.
    pub root: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub app: String,
    pub root: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Daily {
    /// The folder, a full path.
    pub folder: String,
    /// The file name's date format, in moment.js tokens.
    pub format: String,
    /// The template file, a full path.
    pub template: Option<String>,
}

/// How a template's {{date}} and {{time}} are written, in moment.js tokens.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TemplateFormats {
    pub date: Option<String>,
    pub time: Option<String>,
}

/// A folder's conventions; a field no app sets is left to Textus's settings.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Conventions {
    /// The apps whose settings were found, nearest first.
    pub sources: Vec<Source>,
    /// "wiki" or "markdown".
    pub link_style: Option<Setting<String>>,
    /// "shortest", "relative" or "absolute".
    pub link_path: Option<Setting<String>>,
    /// The folder a link starting with "/" is read from.
    pub link_root: Option<Setting<String>>,
    /// On a rename: "always", "ask" or "never".
    pub update_links: Option<Setting<String>>,
    /// Where pictures go: "/" the root, "./" beside the document, "./sub"
    /// below it, else a folder from the root; `${filename}` the document's
    /// name.
    pub attachments: Option<Setting<String>>,
    /// Whether a single newline shows as a line break.
    pub soft_breaks: Option<Setting<bool>>,
    /// The templates folder, a full path.
    pub templates: Option<Setting<String>>,
    pub template_formats: Option<Setting<TemplateFormats>>,
    pub daily: Option<Setting<Daily>>,
    /// Weekly and monthly notes (Periodic Notes), only where turned on.
    pub weekly: Option<Setting<Daily>>,
    pub monthly: Option<Setting<Daily>>,
    /// Where new notes go, as `attachments` names a folder.
    pub new_notes: Option<Setting<String>>,
    /// Paths the app hides (Obsidian's excluded files).
    pub ignore: Vec<String>,
    /// Another app's settings found here and not yet taken or turned down:
    /// offered to the user, who may copy them into `.textus/settings.json`.
    /// They never apply by themselves.
    pub detected: Option<Box<Conventions>>,
    /// `.textus/settings.json` says whether the other app's settings were
    /// taken or turned down: nothing more to offer.
    #[serde(skip)]
    pub(crate) decided: bool,
}

impl Conventions {
    /// `self` with what it leaves unset taken from `other`, a farther or
    /// lesser source.
    fn or(mut self, other: Conventions) -> Conventions {
        macro_rules! fill {
            ($($field:ident),*) => { $( if self.$field.is_none() { self.$field = other.$field; } )* };
        }
        fill!(
            link_style,
            link_path,
            link_root,
            update_links,
            attachments,
            soft_breaks,
            templates,
            template_formats,
            daily,
            weekly,
            monthly,
            new_notes
        );
        if self.ignore.is_empty() {
            self.ignore = other.ignore;
        }
        self.decided |= other.decided;
        if self.detected.is_none() {
            self.detected = other.detected;
        }
        self.sources.extend(other.sources);
        self
    }

    /// The nearest app that keeps notes linked by name, whose folder a
    /// wikilink is resolved in - read whether or not its settings were taken,
    /// since it only says where links are found.
    pub(crate) fn notes_root(&self) -> Option<PathBuf> {
        const NOTE_APPS: [&str; 4] = ["obsidian", "logseq", "dendron", "foam"];
        self.sources
            .iter()
            .find(|s| NOTE_APPS.contains(&s.app.as_str()))
            .map(|s| PathBuf::from(&s.root))
            .or_else(|| self.link_style.as_ref().map(|s| PathBuf::from(&s.root)))
    }

    fn has_settings(&self) -> bool {
        self.link_style.is_some()
            || self.link_path.is_some()
            || self.attachments.is_some()
            || self.soft_breaks.is_some()
            || self.templates.is_some()
            || self.daily.is_some()
            || self.new_notes.is_some()
    }
}

static CACHE: Mutex<Option<HashMap<PathBuf, (Instant, Conventions)>>> = Mutex::new(None);

/// The conventions of the folder `dir`: every app found in it and above it,
/// the nearest deciding each field.
pub(crate) fn of_folder(dir: &Path) -> Conventions {
    // Tests change folders between two asks.
    if cfg!(test) {
        return read_folder(dir);
    }
    if let Some(hit) = CACHE.lock().ok().and_then(|cache| {
        cache
            .as_ref()?
            .get(dir)
            .filter(|(at, _)| at.elapsed() < FRESH)
            .map(|(_, c)| c.clone())
    }) {
        return hit;
    }
    let found = read_folder(dir);
    if let Ok(mut cache) = CACHE.lock() {
        let map = cache.get_or_insert_with(HashMap::new);
        if map.len() > 64 {
            map.clear();
        }
        map.insert(dir.to_path_buf(), (Instant::now(), found.clone()));
    }
    found
}

/// The folder's conventions in three tiers: the project's own
/// `.textus/settings.json` applies; other apps' settings are only detected,
/// to offer; where `/` points and where wikilinks are found are read from
/// any app, since they only make links open.
fn read_folder(dir: &Path) -> Conventions {
    let mut ours = Conventions::default();
    let mut theirs = Conventions::default();
    for found in dir
        .ancestors()
        .take(MAX_ASCENT)
        .flat_map(|d| readers::READERS.iter().filter_map(move |read| read(d)))
    {
        if found.sources.first().is_some_and(|s| s.app == "textus") {
            ours = ours.or(found);
        } else {
            if ours.link_root.is_none() {
                ours.link_root = found.link_root.clone();
            }
            ours.sources.extend(found.sources.clone());
            theirs = theirs.or(found);
        }
    }
    theirs.link_root = None;
    if !ours.decided && theirs.has_settings() {
        ours.detected = Some(Box::new(theirs));
    }
    ours
}

/// The conventions for the document `doc`: its own Typora front matter
/// first, then its folder's.
pub(crate) fn of_document(doc: &Path) -> Conventions {
    let Some(dir) = doc.parent() else {
        return Conventions::default();
    };
    let folder = of_folder(dir);
    let fm = |key| crate::commands::link_root::front_matter_value(doc, key);
    let mut own = Conventions::default();
    let dir_str = dir.to_string_lossy().into_owned();
    let typora = |value| {
        Some(Setting {
            value,
            app: "typora".into(),
            root: dir_str.clone(),
        })
    };
    if let Some(root) = fm("typora-root-url")
        .map(|r| dir.join(r))
        .filter(|r| r.is_dir())
    {
        own.link_root = typora(root.to_string_lossy().into_owned());
    }
    if let Some(to) = fm("typora-copy-images-to").filter(|v| v != "upload") {
        own.attachments = typora(if Path::new(&to).is_absolute() {
            to
        } else {
            format!("./{to}")
        });
    }
    own.or(folder)
}

/// The document or folder at `path`.
pub(crate) fn of_path(path: &Path) -> Conventions {
    if path.is_dir() {
        of_folder(path)
    } else {
        of_document(path)
    }
}

/// A document's or folder's conventions, for the editor and for plugins.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn folder_conventions(path: String) -> Result<Conventions, String> {
    crate::commands::fs::require_non_empty(&path)?;
    tauri::async_runtime::spawn_blocking(move || of_path(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())
}

/// A project's own settings file (`.textus/settings.json`) as a whole, read
/// as the conventions read it (comments and trailing commas allowed); {}
/// when it isn't there or is empty, null when it doesn't read as settings.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn project_settings_read(root: String) -> serde_json::Value {
    let file = Path::new(&root).join(".textus").join("settings.json");
    tauri::async_runtime::spawn_blocking(move || {
        text::json(&file).unwrap_or_else(|| {
            let empty = std::fs::read_to_string(&file).is_ok_and(|t| t.trim().is_empty());
            if file.exists() && !empty {
                serde_json::Value::Null
            } else {
                serde_json::json!({})
            }
        })
    })
    .await
    .unwrap_or(serde_json::Value::Null)
}

/// Whether a document in `dir` shows a single newline as a line break.
#[cfg_attr(not(desktop), allow(dead_code))]
pub(crate) fn soft_breaks_show(dir: &Path) -> bool {
    of_folder(dir).soft_breaks.is_some_and(|s| s.value)
}

/// `rel` under `base`, `.` and `..` folded; None for an absolute path.
fn fold(base: &Path, rel: &str) -> Option<PathBuf> {
    let mut out = base.to_path_buf();
    for part in Path::new(rel).components() {
        match part {
            Component::Normal(p) => out.push(p),
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(out)
}

/// `to` from the folder `from`, with forward slashes.
fn relative(from: &Path, to: &Path) -> String {
    let a: Vec<_> = from.components().collect();
    let b: Vec<_> = to.components().collect();
    let common = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let mut parts: Vec<String> = vec!["..".into(); a.len() - common];
    parts.extend(
        b[common..]
            .iter()
            .map(|c| c.as_os_str().to_string_lossy().into_owned()),
    );
    parts.join("/")
}

/// Where a pasted picture of `doc` goes when its folder says so; None to
/// use Settings > Images.
pub(crate) fn attachment_folder(doc: &Path) -> Option<(ImageFolder, Conventions)> {
    let conventions = of_document(doc);
    let rule = conventions.attachments.as_ref()?;
    let doc_dir = doc.parent()?;
    let stem = doc.file_stem()?.to_string_lossy();
    let root = Path::new(&rule.root);
    let setting = rule.value.trim().replace("${filename}", &stem);
    let dir = match setting.as_str() {
        "" | "/" => Some(root.to_path_buf()),
        "./" | "." => Some(doc_dir.to_path_buf()),
        _ if Path::new(&setting).is_absolute() => Some(PathBuf::from(&setting)),
        _ if setting.starts_with("./") => fold(doc_dir, &setting),
        _ => fold(root, &setting),
    }
    // Never out of the app's folder; Typora's own path may go anywhere.
    .filter(|dir| rule.app == "typora" || dir.starts_with(root))?;
    let folder = ImageFolder {
        src_prefix: relative(doc_dir, &dir),
        dir,
    };
    Some((folder, conventions))
}

/// `![[…]]` for a picture saved at `file`, in the folder's link form; None
/// where links are written as Markdown.
pub(crate) fn wiki_embed(conventions: &Conventions, doc: &Path, file: &Path) -> Option<String> {
    let style = conventions
        .link_style
        .as_ref()
        .filter(|s| s.value == "wiki")?;
    let root = Path::new(&style.root);
    let from_root = file
        .strip_prefix(root)
        .ok()?
        .to_string_lossy()
        .replace('\\', "/");
    let path = conventions
        .link_path
        .as_ref()
        .map_or("shortest", |p| p.value.as_str());
    let link = match path {
        "relative" => relative(doc.parent()?, file),
        "absolute" => from_root,
        _ => {
            // The name alone when no other file under the root ends with it.
            let name = file.file_name()?.to_string_lossy().to_lowercase();
            let tail = format!("/{name}");
            let same = crate::commands::vault::cached_index(root, true)
                .iter()
                .filter(|rel| {
                    let rel = rel.to_lowercase();
                    rel == name || rel.ends_with(&tail)
                })
                .count();
            if same <= 1 {
                file.file_name()?.to_string_lossy().into_owned()
            } else {
                from_root
            }
        }
    };
    Some(format!("![[{link}]]"))
}

#[cfg(test)]
mod tests;
