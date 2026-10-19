//! Quick Notes: a global shortcut (or `textus --quick-note`, or File > New
//! Quick Note) opens a small window to jot something down, and closing it
//! saves the note as a Markdown file in the Quick Notes folder - one file
//! per note, named after its first line, or one file per day with an entry
//! per note. Desktop only.
//!
//! - naming.rs: file names and the per-day file's layout (pure).
//! - window.rs: the window - where it opens, how it closes.
//! - shortcut.rs: the global shortcut.
//! - here: where notes go, the draft that survives a crash, and the writes.
//!
//! The frontend half is src/quick-note/ (the window) and the Quick Notes
//! group in Settings › General.

pub mod naming;
pub mod shortcut;
pub mod window;

use naming::Stamp;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// `textus --quick-note`: open just the Quick Note window - at launch
/// without a main window, or in the running app (single-instance hands the
/// arguments over). What Wayland users bind in their desktop's settings,
/// where no app can register a global shortcut.
pub const CLI_FLAG: &str = "--quick-note";

/// Whether a command line (program name first) asks for a quick note.
pub fn wants_quick_note<S: AsRef<str>>(args: impl IntoIterator<Item = S>) -> bool {
    args.into_iter().skip(1).any(|arg| arg.as_ref() == CLI_FLAG)
}

/// Settings fields read here; SettingsContext.tsx has the rest of each
/// story. `quickNoteFolder` is "" until a note is first saved: then it is
/// fixed to the default folder's path, so the folder stays where it is
/// when the UI language - which names it - changes.
const FOLDER_SETTING: &str = "quickNoteFolder";
const PER_DAY_SETTING: &str = "quickNotePerDay";

/// Rust -> editor windows: a quick note was written to `path`. Mirrors
/// QuickNoteWritten in src/platform/ipc.ts.
pub const WRITTEN_EVENT: &str = "quick-note-written";

/// The default folder's name, by UI language. Here rather than in the
/// frontend's string tables because Rust may need it with no window open
/// (File > Open Quick Notes Folder on macOS); these are the "Quick Notes"
/// of each language's Settings (quickNotesGroup in src/i18n/locales/),
/// Chinese taking the short 速记/速記 of its 随时速记.
fn folder_name(language: &str) -> &'static str {
    match language {
        "zh" => "速记",
        "zh-Hant" => "速記",
        "ja" => "クイックメモ",
        "ko" => "빠른 메모",
        "es" => "Notas rápidas",
        "fr" => "Notes rapides",
        "de" => "Schnellnotizen",
        "ru" => "Быстрые заметки",
        "pt" => "Notas rápidas",
        _ => "Quick Notes",
    }
}

fn setting_str(app: &AppHandle, key: &str) -> Option<String> {
    crate::settings::read_setting(app, key)
        .and_then(|v| v.as_str().map(str::to_string))
        .filter(|s| !s.trim().is_empty())
}

/// `<Documents>/Textus/<Quick Notes in the UI language>`.
fn default_folder(app: &AppHandle) -> PathBuf {
    let documents = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir().map(|home| home.join("Documents")))
        .unwrap_or_default();
    let language = setting_str(app, "language").unwrap_or_default();
    documents
        .join(crate::app_identity::APP_NAME)
        .join(folder_name(&language))
}

/// Where notes go: the folder Settings names, or the default one.
fn folder(app: &AppHandle) -> PathBuf {
    setting_str(app, FOLDER_SETTING)
        .map(PathBuf::from)
        .unwrap_or_else(|| default_folder(app))
}

/// The folder, created, and written into Settings if it was the default -
/// the first time Quick Notes uses it.
fn folder_for_use(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = folder(app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if setting_str(app, FOLDER_SETTING).is_none() {
        let mut patch = serde_json::Map::new();
        patch.insert(
            FOLDER_SETTING.to_string(),
            dir.to_string_lossy().into_owned().into(),
        );
        crate::settings::patch_from_backend(app, patch);
    }
    Ok(dir)
}

fn per_day(app: &AppHandle) -> bool {
    crate::settings::read_setting(app, PER_DAY_SETTING)
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// The window's own files: its draft and the last note it saved. In the
/// app's data folder but NOT in drafts/, whose files the main window
/// restores as tabs at launch.
fn state_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("quick-note"))
        .map_err(|e| e.to_string())
}

/// An existing note a quick note continues: the file, and in a day's file
/// the entry's heading; `base` is the text it started from, which must
/// still be there for the note to write over it. Mirrors QuickNoteTarget in
/// src/platform/ipc.ts.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Target {
    pub path: String,
    pub heading: Option<String>,
    pub base: String,
}

/// What the window is typing, kept while it types. Mirrors QuickNoteDraft
/// in src/platform/ipc.ts.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Draft {
    pub text: String,
    pub target: Option<Target>,
}

/// The last note saved, for the next one to continue (src/quick-note/
/// start.ts decides whether it does). Mirrors QuickNoteLast in
/// src/platform/ipc.ts.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Last {
    pub path: String,
    pub heading: Option<String>,
    pub text: String,
    pub saved_at_ms: u64,
}

/// What a window opening starts from. Mirrors QuickNoteSession in
/// src/platform/ipc.ts.
#[derive(Serialize)]
pub struct Session {
    draft: Option<Draft>,
    last: Option<Last>,
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// A file as the editor holds text: "\n" line breaks, no BOM.
fn read_text(path: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    Some(raw.trim_start_matches('\u{feff}').replace("\r\n", "\n"))
}

/// `last`, if the note it names is still there as it was written - the
/// text to continue from, read again (it may have been edited in the main
/// window since).
fn still_there(last: Last) -> Option<Last> {
    let current = read_text(Path::new(&last.path))?;
    match &last.heading {
        None => Some(Last {
            text: current.trim_end().to_string(),
            ..last
        }),
        Some(heading) => naming::has_entry(&current, heading, &last.text).then_some(last),
    }
}

#[tauri::command(async)]
pub fn quick_note_session(app: AppHandle) -> Result<Session, String> {
    let dir = state_dir(&app)?;
    let draft = read_json::<Draft>(&dir.join("draft.json")).filter(|d| !d.text.trim().is_empty());
    let last = read_json::<Last>(&dir.join("last.json")).and_then(still_there);
    Ok(Session { draft, last })
}

#[tauri::command(async)]
pub fn quick_note_save_draft(
    app: AppHandle,
    text: String,
    target: Option<Target>,
) -> Result<(), String> {
    let dir = state_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_vec(&Draft { text, target }).map_err(|e| e.to_string())?;
    crate::atomic::write_sync(&dir.join("draft.json"), json).map_err(|e| e.to_string())
}

fn discard_draft(app: &AppHandle) {
    if let Ok(dir) = state_dir(app) {
        let _ = std::fs::remove_file(dir.join("draft.json"));
    }
}

#[tauri::command(async)]
pub fn quick_note_discard_draft(app: AppHandle) {
    discard_draft(&app);
}

/// Every path an editor window has open (session.rs keeps the list).
fn open_paths(app: &AppHandle) -> Vec<String> {
    app.try_state::<crate::commands::session::SessionTabsState>()
        .map(|state| {
            state
                .0
                .lock()
                .unwrap()
                .values()
                .flatten()
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

/// One note written: where, and the file before and after, which an open
/// editor tab of it reloads or merges from. `entry` is the block a day's
/// file gained at its end, when that is all that changed. Mirrors
/// QuickNoteWritten in src/platform/ipc.ts.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Written {
    pub path: String,
    pub before: Option<String>,
    pub after: String,
    pub entry: Option<String>,
    #[serde(skip)]
    pub heading: Option<String>,
}

/// Where a write goes and what it does - everything but the writing, so
/// the decisions are testable without a disk. `read` is the file system's
/// view (None: no such file), `open` whether an editor window has a path.
pub struct Plan {
    pub written: Written,
    /// A continued note that was renamed: its old file, removed once the
    /// new one is written.
    pub remove: Option<PathBuf>,
}

pub fn plan(
    dir: &Path,
    text: &str,
    target: Option<&Target>,
    per_day: bool,
    stamp: &Stamp,
    read: &dyn Fn(&Path) -> Option<String>,
    open: &dyn Fn(&Path) -> bool,
) -> Plan {
    let note = naming::normalize_note(text);
    // A continued note whose file has changed under it since - edited in
    // the main window, removed - goes in as a new note: writing over it
    // would lose whatever happened there.
    let target = target.filter(|t| {
        let Some(current) = read(Path::new(&t.path)) else {
            return false;
        };
        match &t.heading {
            None => current.trim_end() == t.base.trim_end(),
            Some(heading) => naming::has_entry(&current, heading, &t.base),
        }
    });

    // A continued note stays what it was - an entry, or a file of its own -
    // whatever the setting says now.
    match target {
        // A day's entry, continued.
        Some(t) if t.heading.is_some() => {
            let path = PathBuf::from(&t.path);
            let before = read(&path).unwrap_or_default();
            let heading = t.heading.clone().unwrap_or_default();
            let after = naming::replace_entry(&before, &heading, &t.base, &note)
                .unwrap_or_else(|| before.clone());
            Plan {
                written: Written {
                    path: t.path.clone(),
                    before: Some(before),
                    after,
                    entry: None,
                    heading: Some(heading),
                },
                remove: None,
            }
        }
        // A new entry at the end of today's file.
        None if per_day => {
            let path = naming::day_file(dir, stamp);
            let before = read(&path);
            let heading = stamp.heading();
            let entry = naming::entry_block(&heading, &note);
            let after = naming::join_entry(before.as_deref().unwrap_or(""), &entry);
            Plan {
                written: Written {
                    path: path.to_string_lossy().into_owned(),
                    before,
                    after,
                    entry: Some(entry),
                    heading: Some(heading),
                },
                remove: None,
            }
        }
        // A note of its own, continued: renamed when its first line changed,
        // unless a window has it open (the tab would lose its file).
        Some(t) => {
            let old = PathBuf::from(&t.path);
            let before = read(&old);
            let parent = old.parent().map(Path::to_path_buf).unwrap_or_default();
            let stem = naming::note_stem(&note, stamp);
            let same_stem = old.file_stem().is_some_and(|s| s.to_string_lossy() == stem);
            let path = if same_stem || open(&old) {
                old.clone()
            } else {
                naming::unique_path(&parent, &stem, Some(&old), |p| {
                    read(p).is_some() || p.exists()
                })
            };
            Plan {
                remove: (path != old).then_some(old),
                written: Written {
                    path: path.to_string_lossy().into_owned(),
                    before,
                    after: note,
                    entry: None,
                    heading: None,
                },
            }
        }
        // A new note: named after its first line, numbered if that's taken.
        None => {
            let stem = naming::note_stem(&note, stamp);
            let path = naming::unique_path(dir, &stem, None, |p| read(p).is_some() || p.exists());
            Plan {
                written: Written {
                    path: path.to_string_lossy().into_owned(),
                    before: None,
                    after: note,
                    entry: None,
                    heading: None,
                },
                remove: None,
            }
        }
    }
}

/// One write at a time: two notes saved together (the shortcut window and
/// a quit) must not both read today's file before either has written it.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn commit(
    app: &AppHandle,
    text: &str,
    target: Option<&Target>,
    stamp: &Stamp,
) -> Result<Option<Written>, String> {
    if text.trim().is_empty() {
        // Nothing written: an empty note is a note not taken.
        discard_draft(app);
        return Ok(None);
    }
    if !stamp.is_valid() {
        return Err("invalid time stamp".to_string());
    }
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dir = folder_for_use(app)?;
    let open = open_paths(app);
    let plan = plan(
        &dir,
        text,
        target,
        per_day(app),
        stamp,
        &|p| read_text(p),
        &|p| open.iter().any(|o| Path::new(o) == p),
    );
    let written = plan.written;
    let path = PathBuf::from(&written.path);
    // The file as it is on disk keeps its line endings (a day's file saved
    // from Windows); a new one gets "\n".
    let on_disk = std::fs::read_to_string(&path).unwrap_or_default();
    let contents = naming::in_line_endings_of(&on_disk, &written.after);
    let bom = if on_disk.starts_with('\u{feff}') {
        "\u{feff}"
    } else {
        ""
    };
    crate::atomic::write_sync(&path, format!("{bom}{contents}")).map_err(|e| e.to_string())?;
    if let Some(old) = &plan.remove {
        let _ = std::fs::remove_file(old);
    }

    // What the next note may continue, and the draft it no longer needs.
    let state = state_dir(app)?;
    let _ = std::fs::create_dir_all(&state);
    let last = Last {
        path: written.path.clone(),
        heading: written.heading.clone(),
        text: naming::normalize_note(text).trim_end().to_string(),
        saved_at_ms: now_ms(),
    };
    if let Ok(json) = serde_json::to_vec(&last) {
        let _ = crate::atomic::write_sync(&state.join("last.json"), json);
    }
    discard_draft(app);
    Ok(Some(written))
}

/// Saves the note (nothing for an empty one) and tells the editor windows,
/// so a tab of the same file reloads or merges. Resolves to the file.
#[tauri::command(async)]
pub fn quick_note_commit(
    app: AppHandle,
    text: String,
    target: Option<Target>,
    stamp: Stamp,
) -> Result<Option<String>, String> {
    let Some(written) = commit(&app, &text, target.as_ref(), &stamp)? else {
        return Ok(None);
    };
    for label in app.webview_windows().into_keys() {
        if crate::commands::chat_window::is_editor_window(&label) {
            let _ = app.emit_to(
                tauri::EventTarget::webview_window(&label),
                WRITTEN_EVENT,
                written.clone(),
            );
        }
    }
    Ok(Some(written.path))
}

/// The file a note would be saved as now, for the window's header: the
/// same decision the commit makes, without writing.
#[tauri::command(async)]
pub fn quick_note_preview_name(
    app: AppHandle,
    text: String,
    target: Option<Target>,
    stamp: Stamp,
) -> Option<String> {
    if !stamp.is_valid() {
        return None;
    }
    let dir = folder(&app);
    let open = open_paths(&app);
    let plan = plan(
        &dir,
        &text,
        target.as_ref(),
        per_day(&app),
        &stamp,
        &|p| read_text(p),
        &|p| open.iter().any(|o| Path::new(o) == p),
    );
    Path::new(&plan.written.path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
}

/// Closes the window. `back` hands focus back to the app the note was
/// taken over (window.rs's finish).
#[tauri::command(async)]
pub fn quick_note_finish(app: AppHandle, back: bool) {
    window::finish(&app, back);
}

/// "Open in Textus": the saved note as a tab of an editor window - the
/// focused one, or any, or a new one when there is none - which comes
/// forward. With no note, just the window.
#[tauri::command(async)]
pub fn quick_note_open_in_editor(app: AppHandle, path: Option<String>) {
    match crate::menu::focused_editor_window(&app) {
        Some(label) => {
            if let Some(path) = path {
                let _ = app.emit_to(
                    tauri::EventTarget::webview_window(&label),
                    "open-paths-as-tabs",
                    vec![path],
                );
            }
            if let Some(editor) = app.get_webview_window(&label) {
                let _ = editor.unminimize();
                let _ = editor.set_focus();
            }
        }
        None => {
            if let Some(path) = path {
                crate::queue_pending(&app, vec![path]);
            }
            let _ = crate::open_new_window(&app);
        }
    }
    window::finish(&app, false);
}

/// The editor has mounted and has focus: the note can be typed.
#[tauri::command]
pub fn quick_note_ready() -> Option<u64> {
    window::ready().map(|ms| ms as u64)
}

/// Where notes go now, for Settings. Mirrors QuickNoteFolder in
/// src/platform/ipc.ts.
#[derive(Serialize)]
pub struct Folder {
    path: String,
}

#[tauri::command]
pub fn quick_note_folder(app: AppHandle) -> Folder {
    Folder {
        path: folder(&app).to_string_lossy().into_owned(),
    }
}

/// Settings › Quick Notes › Change…: a folder picker. The frontend stores
/// the answer.
#[tauri::command]
pub async fn quick_note_pick_folder(
    window: tauri::WebviewWindow,
) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        crate::commands::fs::window_file_dialog(&window).blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(picked.map(|p| p.to_string()))
}

/// Shows the folder in the file manager, creating it first.
pub fn open_folder(app: &AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = folder_for_use(app)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn quick_note_open_folder(app: AppHandle) -> Result<(), String> {
    open_folder(&app)
}

/// The command that opens a quick note, exactly as a shell or a desktop's
/// shortcut settings need it: this executable's real path (an AppImage's
/// own file, not the mount it runs from), quoted when it must be.
#[tauri::command]
pub fn quick_note_cli_command() -> String {
    let exe = std::env::var("APPIMAGE")
        .ok()
        .filter(|path| !path.is_empty())
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .map(|p| p.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "textus".to_string());
    format!("{} {CLI_FLAG}", shell_quote(&exe, cfg!(windows)))
}

fn shell_quote(path: &str, windows: bool) -> String {
    let plain = path
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "/\\:._-+".contains(c));
    if plain {
        path.to_string()
    } else if windows {
        format!("\"{path}\"")
    } else {
        format!("'{}'", path.replace('\'', "'\\''"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::Path;

    fn stamp() -> Stamp {
        Stamp {
            date: "2026-10-19".into(),
            time: "14:32".into(),
        }
    }

    fn files(entries: &[(&str, &str)]) -> HashMap<PathBuf, String> {
        entries
            .iter()
            .map(|(p, t)| (PathBuf::from(p), t.to_string()))
            .collect()
    }

    fn run(
        disk: &HashMap<PathBuf, String>,
        text: &str,
        target: Option<&Target>,
        per_day: bool,
        open: &[&str],
    ) -> Plan {
        plan(
            Path::new("/notes"),
            text,
            target,
            per_day,
            &stamp(),
            &|p| disk.get(p).cloned(),
            &|p| open.iter().any(|o| Path::new(o) == p),
        )
    }

    #[test]
    fn the_command_line_flag_asks_for_a_quick_note() {
        assert!(wants_quick_note(["textus", "--quick-note"]));
        assert!(wants_quick_note(["/x/textus", "a.md", "--quick-note"]));
        assert!(!wants_quick_note(["textus"]));
        assert!(!wants_quick_note(["textus", "--quick-notes"]));
        // The program's own name is never the flag.
        assert!(!wants_quick_note(["--quick-note"]));
        // And the flag is no file to open.
        assert!(crate::paths_from_argv(
            ["textus".to_string(), "--quick-note".to_string()],
            Path::new("/home")
        )
        .is_empty());
    }

    #[test]
    fn a_new_note_gets_a_file_of_its_own() {
        let disk = files(&[("/notes/Idea.md", "old")]);
        let plan = run(&disk, "Idea\nmore", None, false, &[]);
        assert_eq!(plan.written.path, "/notes/Idea-2.md");
        assert_eq!(plan.written.after, "Idea\nmore\n");
        assert_eq!(plan.written.before, None);
    }

    #[test]
    fn per_day_notes_are_appended_under_their_time() {
        let disk = files(&[("/notes/2026-10-19.md", "## 09:00\n\nMorning\n")]);
        let plan = run(&disk, "Afternoon", None, true, &[]);
        assert_eq!(plan.written.path, "/notes/2026-10-19.md");
        assert_eq!(
            plan.written.after,
            "## 09:00\n\nMorning\n\n## 14:32\n\nAfternoon\n"
        );
        assert_eq!(
            plan.written.entry.as_deref(),
            Some("## 14:32\n\nAfternoon\n")
        );
        // The first of the day starts the file.
        let plan = run(&HashMap::new(), "First", None, true, &[]);
        assert_eq!(plan.written.after, "## 14:32\n\nFirst\n");
        assert_eq!(plan.written.before, None);
    }

    #[test]
    fn a_continued_note_updates_its_file_and_follows_its_first_line() {
        let disk = files(&[("/notes/Draft.md", "Draft\n")]);
        let target = Target {
            path: "/notes/Draft.md".into(),
            heading: None,
            base: "Draft".into(),
        };
        let plan = run(&disk, "Plan\nDraft", Some(&target), false, &[]);
        assert_eq!(plan.written.path, "/notes/Plan.md");
        assert_eq!(plan.remove.as_deref(), Some(Path::new("/notes/Draft.md")));
        // Open in a window: the name stays, so the tab keeps its file.
        let plan = run(
            &disk,
            "Plan\nDraft",
            Some(&target),
            false,
            &["/notes/Draft.md"],
        );
        assert_eq!(plan.written.path, "/notes/Draft.md");
        assert_eq!(plan.remove, None);
        assert_eq!(plan.written.before.as_deref(), Some("Draft\n"));
    }

    #[test]
    fn a_continued_note_changed_elsewhere_is_saved_as_a_new_one() {
        let disk = files(&[("/notes/Draft.md", "Draft, edited in the editor\n")]);
        let target = Target {
            path: "/notes/Draft.md".into(),
            heading: None,
            base: "Draft".into(),
        };
        let plan = run(&disk, "Draft and more", Some(&target), false, &[]);
        assert_eq!(plan.written.path, "/notes/Draft and more.md");
        assert_eq!(plan.remove, None);
    }

    #[test]
    fn a_continued_day_entry_is_rewritten_in_place() {
        let day = "## 09:00\n\nMorning\n\n## 14:32\n\nDraft\n";
        let disk = files(&[("/notes/2026-10-19.md", day)]);
        let target = Target {
            path: "/notes/2026-10-19.md".into(),
            heading: Some("## 14:32".into()),
            base: "Draft".into(),
        };
        let plan = run(&disk, "Draft, done", Some(&target), true, &[]);
        assert_eq!(
            plan.written.after,
            "## 09:00\n\nMorning\n\n## 14:32\n\nDraft, done\n"
        );
        assert_eq!(plan.written.entry, None);
        // The entry was edited since: the note becomes a new entry.
        let edited = files(&[("/notes/2026-10-19.md", "## 14:32\n\nDraft!\n")]);
        let plan = run(&edited, "Draft, done", Some(&target), true, &[]);
        assert_eq!(
            plan.written.after,
            "## 14:32\n\nDraft!\n\n## 14:32\n\nDraft, done\n"
        );
    }

    #[test]
    fn the_folder_name_follows_the_language_and_defaults_to_english() {
        assert_eq!(folder_name("zh"), "速记");
        assert_eq!(folder_name("en"), "Quick Notes");
        assert_eq!(folder_name("xx"), "Quick Notes");
        for lang in [
            "en", "zh", "zh-Hant", "ja", "ko", "es", "fr", "de", "ru", "pt",
        ] {
            assert_eq!(naming::sanitize_stem(folder_name(lang)), folder_name(lang));
        }
    }

    #[test]
    fn the_command_is_quoted_for_the_shell_that_runs_it() {
        assert_eq!(shell_quote("/usr/bin/textus", false), "/usr/bin/textus");
        assert_eq!(
            shell_quote("/home/a b/Textus.AppImage", false),
            "'/home/a b/Textus.AppImage'"
        );
        assert_eq!(shell_quote("/it's", false), "'/it'\\''s'");
        assert_eq!(
            shell_quote("C:\\Program Files\\Textus\\textus.exe", true),
            "\"C:\\Program Files\\Textus\\textus.exe\""
        );
    }
}
