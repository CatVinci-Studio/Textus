//! The file tree's open folders, watched for what other apps (Git, a sync
//! client, Finder) change in them. On macOS and Linux each folder is watched
//! alone, not what is below it: a folded or hidden folder costs nothing, and
//! `.git` or an ignored folder is never watched unless the user opens it. On
//! Windows a watched folder holds a handle that keeps every folder above it
//! from being renamed, moved or trashed, so the topmost open folder is
//! watched whole instead, and only its open folders' changes are kept.
//! Changes are gathered for 150 ms and sent to the window as the folders to
//! read again. Desktop only: on a phone the tree reads its folders again on
//! focus.

use notify::event::{ModifyKind, RenameMode};
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
    /// What the system watches, and how.
    watched: HashMap<PathBuf, RecursiveMode>,
}

/// Each window's watch, and the newest call each window made, by label.
#[derive(Default)]
pub struct TreeWatches(Mutex<Watches>);

#[derive(Default)]
pub struct Watches {
    by_window: HashMap<String, WindowWatch>,
    asked: HashMap<String, f64>,
}

/// Whether a window's call numbered `seq` is newer than any before it;
/// the calls can arrive out of order.
fn newest(asked: &mut HashMap<String, f64>, label: &str, seq: f64) -> bool {
    if asked.get(label).is_some_and(|&last| last >= seq) {
        return false;
    }
    asked.insert(label.to_string(), seq);
    true
}

/// Watching a folder whole, its open folders' changes picked out: where a
/// watch holds the folder open (Windows).
const WATCH_WHOLE: bool = cfg!(windows);

/// What the system watches for the open folders `dirs`: each alone, or with
/// `whole`, the topmost ones with all below them.
fn watch_plan<'a>(
    dirs: impl Iterator<Item = &'a PathBuf> + Clone,
    whole: bool,
) -> HashMap<PathBuf, RecursiveMode> {
    if !whole {
        return dirs
            .map(|d| (d.clone(), RecursiveMode::NonRecursive))
            .collect();
    }
    let all = dirs.clone();
    dirs.filter(|d| !all.clone().any(|o| o != *d && d.starts_with(o)))
        .map(|d| (d.clone(), RecursiveMode::Recursive))
        .collect()
}

static OWN_WRITES: Mutex<Vec<(PathBuf, Instant)>> = Mutex::new(Vec::new());

/// `path` with its folder canonical, as the system reports changes in it.
fn canonical(path: &Path) -> PathBuf {
    crate::atomic::real_path(path).unwrap_or_else(|| path.to_path_buf())
}

/// The app is about to write over `path`: its change is not news to the tree.
pub(crate) fn note_own_write(path: &Path) {
    let path = canonical(path);
    let now = Instant::now();
    let mut own = OWN_WRITES.lock().unwrap_or_else(|e| e.into_inner());
    own.retain(|(_, at)| now.duration_since(*at) < OWN_FOR);
    own.push((path, now));
}

/// Whether the `index`th path of an event of `kind` can be one the app
/// wrote: made or written over, never taken away.
fn as_written(kind: &EventKind, index: usize, path: &Path) -> bool {
    match kind {
        EventKind::Create(_) => true,
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => true,
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => index == 1,
        // FSEvents doesn't say which side of a rename a path was, and
        // Windows reports the file a save renamed over as removed: either
        // way, a path still there was written over, not taken away.
        EventKind::Modify(ModifyKind::Name(RenameMode::Any | RenameMode::From))
        | EventKind::Remove(_) => path.exists(),
        EventKind::Modify(ModifyKind::Name(_)) => false,
        EventKind::Modify(_) => true,
        _ => false,
    }
}

fn is_own_write(path: &Path) -> bool {
    let own = OWN_WRITES.lock().unwrap_or_else(|e| e.into_inner());
    own.iter()
        .any(|(p, at)| p == path && at.elapsed() < OWN_FOR)
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
    for (index, path) in event.paths.iter().enumerate() {
        if crate::atomic::is_temp_name(path) || (as_written(&event.kind, index, path) && own(path))
        {
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
    Ok(WindowWatch {
        watcher,
        known,
        watched: HashMap::new(),
    })
}

/// Watches `dirs`, the folders open in this window's tree, in place of what
/// it watched before; none stops. `seq` numbers the window's calls, which
/// can arrive out of order: an older one than the last is passed over. False
/// when one couldn't be watched (the system's limit on watches), or the
/// window is gone: the tree then reads its folders on focus.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn tree_watch(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, TreeWatches>,
    dirs: Vec<String>,
    seq: f64,
) -> Result<bool, String> {
    let mut watches = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let label = window.label();
    // A window destroyed meanwhile would keep a watch nothing ends.
    if window.app_handle().get_webview_window(label).is_none() {
        return Ok(false);
    }
    if !newest(&mut watches.asked, label, seq) {
        return Ok(true);
    }
    if dirs.is_empty() {
        watches.by_window.remove(label);
        return Ok(true);
    }
    if !watches.by_window.contains_key(label) {
        let (app, to) = (window.app_handle().clone(), label.to_string());
        let watch = watcher(move |changed| {
            let _ = app.emit_to(
                tauri::EventTarget::webview_window(to.as_str()),
                EVENT,
                changed,
            );
        })
        .map_err(|e| e.to_string())?;
        watches.by_window.insert(label.to_string(), watch);
    }
    let Some(watch) = watches.by_window.get_mut(label) else {
        return Ok(false);
    };
    Ok(watch_only(watch, dirs, WATCH_WHOLE))
}

/// `watch` follows `dirs` alone (`whole`: `watch_plan`'s); false when one
/// couldn't be watched.
fn watch_only(watch: &mut WindowWatch, dirs: Vec<String>, whole: bool) -> bool {
    let wanted: HashMap<PathBuf, String> = dirs
        .into_iter()
        .filter_map(|dir| Some((std::fs::canonicalize(&dir).ok()?, dir)))
        .collect();
    let plan = watch_plan(wanted.keys(), whole);
    let gone: Vec<PathBuf> = watch
        .watched
        .iter()
        .filter(|(path, mode)| plan.get(*path) != Some(*mode))
        .map(|(path, _)| path.clone())
        .collect();
    for path in gone {
        let _ = watch.watcher.unwatch(&path);
        watch.watched.remove(&path);
    }
    let mut live = true;
    for (path, mode) in plan {
        if watch.watched.contains_key(&path) {
            continue;
        }
        if watch.watcher.watch(&path, mode).is_ok() {
            watch.watched.insert(path, mode);
        } else {
            live = false;
        }
    }
    *watch.known.lock().unwrap_or_else(|e| e.into_inner()) = wanted;
    live
}

/// A window closed: its watch stops.
pub(crate) fn window_gone(app: &tauri::AppHandle, label: &str) {
    if let Some(state) = app.try_state::<TreeWatches>() {
        let mut watches = state.0.lock().unwrap_or_else(|e| e.into_inner());
        watches.by_window.remove(label);
        watches.asked.remove(label);
    }
}

#[cfg(test)]
mod tests;
