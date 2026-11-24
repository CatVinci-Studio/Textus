//! The file tree's open folders, watched for what other apps (Git, a sync
//! client, Finder) change in them. Each folder is watched alone, not what is
//! below it: a folded or hidden folder costs nothing, and `.git` or an
//! ignored folder is never watched unless the user opens it. Changes are
//! gathered for 150 ms and sent to the window as the folders to read again.
//! Desktop only: on a phone the tree reads its folders again on focus.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tokio::sync::mpsc;

/// Quiet this long, the changes gathered are sent.
const QUIET: Duration = Duration::from_millis(150);
/// A change that never goes quiet (a checkout, a sync) is still sent this often.
const MOST: Duration = Duration::from_secs(1);
/// How long a file the app wrote is taken as its own change.
const OWN_FOR: Duration = Duration::from_secs(2);

pub(crate) const EVENT: &str = "tree-dirs-changed";

/// The folders to read again; `all`: every open one, when the system lost
/// track. Shape shared with `src/files/useDiskWatch.ts`.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
pub(crate) struct DirsChanged {
    dirs: Vec<String>,
    all: bool,
}

/// The watched folders: as the system reports them (canonical), to the path
/// the tree knows each by.
type Known = Arc<Mutex<HashMap<PathBuf, String>>>;

struct WindowWatch {
    watcher: RecommendedWatcher,
    known: Known,
}

/// Each window's watch, by its label.
#[derive(Default)]
pub struct TreeWatches(Mutex<HashMap<String, WindowWatch>>);

static OWN_WRITES: Mutex<Vec<(PathBuf, Instant)>> = Mutex::new(Vec::new());

/// `path` with its folder canonical, as the system reports changes in it.
fn canonical(path: &Path) -> PathBuf {
    if let Ok(real) = std::fs::canonicalize(path) {
        return real;
    }
    match (path.parent().map(std::fs::canonicalize), path.file_name()) {
        (Some(Ok(dir)), Some(name)) => dir.join(name),
        _ => path.to_path_buf(),
    }
}

/// The app is about to write `path`: its change is not news to the tree.
pub(crate) fn note_own_write(path: &Path) {
    let path = canonical(path);
    let now = Instant::now();
    let mut own = OWN_WRITES.lock().unwrap_or_else(|e| e.into_inner());
    own.retain(|(_, at)| now.duration_since(*at) < OWN_FOR);
    own.push((path, now));
}

fn is_own_write(path: &Path) -> bool {
    let own = OWN_WRITES.lock().unwrap_or_else(|e| e.into_inner());
    own.iter()
        .any(|(p, at)| p == path && at.elapsed() < OWN_FOR)
}

/// The temp file an atomic write renames into place (atomic.rs).
fn is_write_temp(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with('.') && n.ends_with(".tmp"))
}

/// What one event changed: the watched folders it touched, or `None` when
/// the system lost track and every folder must be read again.
fn touched(
    event: &notify::Result<Event>,
    known: &HashMap<PathBuf, String>,
    own: impl Fn(&Path) -> bool,
) -> Option<Vec<String>> {
    let event = match event {
        Ok(event) if !event.need_rescan() => event,
        _ => return None,
    };
    if matches!(event.kind, EventKind::Access(_)) {
        return Some(Vec::new());
    }
    let mut dirs = Vec::new();
    for path in &event.paths {
        if is_write_temp(path) || own(path) {
            continue;
        }
        // The folder it is in, and the folder itself when it was the one
        // changed (removed, renamed).
        for dir in [path.parent(), Some(path.as_path())].into_iter().flatten() {
            if let Some(given) = known.get(dir) {
                dirs.push(given.clone());
            }
        }
    }
    Some(dirs)
}

/// Gathers what each event touched until 150 ms pass with none (or a
/// second in all), then `send`s it once. Ends when the watcher is dropped.
async fn coalesce(
    mut events: mpsc::UnboundedReceiver<notify::Result<Event>>,
    known: Known,
    own: impl Fn(&Path) -> bool,
    mut send: impl FnMut(DirsChanged),
) {
    let take = |event: &notify::Result<Event>, batch: &mut (BTreeSet<String>, bool)| {
        let known = known.lock().unwrap_or_else(|e| e.into_inner());
        match touched(event, &known, &own) {
            Some(dirs) => batch.0.extend(dirs),
            None => batch.1 = true,
        }
    };
    loop {
        let mut batch = (BTreeSet::new(), false);
        while batch.0.is_empty() && !batch.1 {
            let Some(event) = events.recv().await else {
                return;
            };
            take(&event, &mut batch);
        }
        let started = tokio::time::Instant::now();
        loop {
            let until = (tokio::time::Instant::now() + QUIET).min(started + MOST);
            match tokio::time::timeout_at(until, events.recv()).await {
                Ok(Some(event)) => take(&event, &mut batch),
                Ok(None) | Err(_) => break,
            }
        }
        send(DirsChanged {
            dirs: batch.0.into_iter().collect(),
            all: batch.1,
        });
    }
}

/// A watcher whose changes, gathered, go to `send`, and the folders it
/// watches, which the caller fills.
fn watcher(send: impl FnMut(DirsChanged) + Send + 'static) -> notify::Result<WindowWatch> {
    let (tx, rx) = mpsc::unbounded_channel();
    let watcher = notify::recommended_watcher(move |event| {
        let _ = tx.send(event);
    })?;
    let known = Known::default();
    tauri::async_runtime::spawn(coalesce(rx, known.clone(), is_own_write, send));
    Ok(WindowWatch { watcher, known })
}

/// Watches `dirs`, the folders open in this window's tree, in place of what
/// it watched before; none stops. False when one couldn't be watched (the
/// system's limit on watches): the tree then reads its folders on focus.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn tree_watch(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, TreeWatches>,
    dirs: Vec<String>,
) -> Result<bool, String> {
    let mut watches = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let label = window.label();
    if dirs.is_empty() {
        watches.remove(label);
        return Ok(true);
    }
    if !watches.contains_key(label) {
        let (app, to) = (window.app_handle().clone(), label.to_string());
        let watch = watcher(move |changed| {
            let _ = app.emit_to(to.as_str(), EVENT, changed);
        })
        .map_err(|e| e.to_string())?;
        watches.insert(label.to_string(), watch);
    }
    let Some(watch) = watches.get_mut(label) else {
        return Ok(false);
    };
    Ok(watch_only(watch, dirs))
}

/// `watch` follows `dirs` alone; false when one couldn't be watched.
fn watch_only(watch: &mut WindowWatch, dirs: Vec<String>) -> bool {
    let wanted: HashMap<PathBuf, String> = dirs
        .into_iter()
        .filter_map(|dir| Some((std::fs::canonicalize(&dir).ok()?, dir)))
        .collect();
    let mut known = watch.known.lock().unwrap_or_else(|e| e.into_inner());
    let gone: Vec<PathBuf> = known
        .keys()
        .filter(|p| !wanted.contains_key(*p))
        .cloned()
        .collect();
    for path in gone {
        let _ = watch.watcher.unwatch(&path);
        known.remove(&path);
    }
    let mut live = true;
    for (path, given) in wanted {
        if known.contains_key(&path)
            || watch
                .watcher
                .watch(&path, RecursiveMode::NonRecursive)
                .is_ok()
        {
            known.insert(path, given);
        } else {
            live = false;
        }
    }
    live
}

/// A window closed: its watch stops.
pub(crate) fn window_gone(app: &tauri::AppHandle, label: &str) {
    if let Some(state) = app.try_state::<TreeWatches>() {
        state
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(label);
    }
}

#[cfg(test)]
mod tests;
