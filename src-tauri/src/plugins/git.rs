//! A plugin's view of the open folder's Git history, read with the user's own
//! git (desktop): the branch and what changed, a file's commits (through
//! renames), the file as a commit had it, and a commit of the files named,
//! made as the user would make it (hooks, signing). Every path is checked as
//! a read of the folder is; .git itself is never handed over.

mod process;
mod remote;
mod safety;

use super::access::{checked_root, folder_path};
use super::state::{self, PluginsState};
use process::{run, run_within, COMMIT_TIME};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// A commit's text at most: a document, not a build's output.
const MAX_SHOW_BYTES: usize = 8 * 1024 * 1024;
/// The changed files listed at most.
const MAX_CHANGES: usize = 5000;
const MAX_LOG: u32 = 500;

#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct GitChange {
    pub path: String,
    /// modified, added, deleted, renamed, untracked or conflicted.
    pub state: String,
    /// In the index already (`git add`ed).
    pub staged: bool,
}

#[derive(Serialize, Debug)]
#[cfg_attr(test, derive(specta::Type))]
pub struct GitStatus {
    /// None when HEAD is detached.
    pub branch: Option<String>,
    /// The remote branch it follows (`origin/main`); None with none.
    pub upstream: Option<String>,
    /// Commits here the remote branch hasn't, and there that this hasn't.
    pub ahead: u32,
    pub behind: u32,
    pub changes: Vec<GitChange>,
}

#[derive(Serialize, Debug)]
#[cfg_attr(test, derive(specta::Type))]
pub struct GitCommit {
    pub hash: String,
    /// Milliseconds since 1970, when it was committed.
    pub at: f64,
    pub author: String,
    pub subject: String,
    /// The file's path in this commit (it may have been renamed since).
    pub path: String,
}

/// The repository's top folder, or None when the folder is in none.
fn top(root: &Path) -> Option<PathBuf> {
    let out = run(root, &["rev-parse", "--show-toplevel"], None).ok()?;
    let top = PathBuf::from(String::from_utf8_lossy(&out).trim());
    std::fs::canonicalize(&top).ok()
}

/// Where the repository at `top` keeps its settings and hooks.
fn sources(top: &Path) -> safety::Sources {
    let dir = |flag: &str| {
        let out = run(top, &["rev-parse", flag], None).ok()?;
        Some(top.join(String::from_utf8_lossy(&out).trim()))
    };
    let common = dir("--git-common-dir").unwrap_or_else(|| top.join(".git"));
    let own = dir("--git-dir").unwrap_or_else(|| common.clone());
    safety::Sources {
        configs: vec![common.join("config"), own.join("config.worktree")],
        hooks: common.join("hooks"),
    }
}

/// Git works in the repository at `top` only while nothing there starts a
/// program the writer hasn't agreed to (`trusted`, the list they keep).
fn guard(trusted: &Path, top: &Path, committing: bool) -> Result<(), String> {
    let risks = safety::risks(&sources(top), committing);
    if risks.is_empty() || safety::trusted(trusted, top, &risks) {
        return Ok(());
    }
    Err(format!("{}{}", safety::UNTRUSTED, risks.join(", ")))
}

/// `path` (checked for plugin `id` to read) from the repository's top, with
/// forward slashes.
fn from_top(
    state: &PluginsState,
    id: &str,
    root: &str,
    top: &Path,
    path: &str,
) -> Result<String, String> {
    let file = folder_path(state, id, "files.read", root, path)?;
    let rel = file
        .strip_prefix(top)
        .map_err(|_| "The file isn't in the folder's repository.".to_string())?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

/// How a call names the files git gives: under the folder as the window
/// names it, which git names by its real path (/private/var for /var, a
/// link's target).
struct Names<'a> {
    root: &'a str,
    real_root: Option<PathBuf>,
}

impl<'a> Names<'a> {
    fn new(root: &'a str) -> Self {
        Names {
            root,
            real_root: std::fs::canonicalize(root).ok(),
        }
    }
}

/// A path git gave (from the top) as the plugin sees it, if it may read it.
fn shown(state: &PluginsState, id: &str, names: &Names, top: &Path, rel: &str) -> Option<String> {
    let (root, real) = (names.root, top.join(rel));
    let base = names.real_root.as_deref()?;
    let path = match real.strip_prefix(base) {
        Ok(rest) => Path::new(root).join(rest),
        Err(_) => real,
    };
    folder_path(state, id, "files.read", root, &path.to_string_lossy()).ok()?;
    Some(path.to_string_lossy().to_string())
}

fn change_state(kind: &str, xy: &str) -> &'static str {
    match kind {
        "?" => "untracked",
        "2" => "renamed",
        "u" => "conflicted",
        _ if xy.contains('A') => "added",
        _ if xy.contains('D') => "deleted",
        _ => "modified",
    }
}

pub(super) fn status(
    state: &PluginsState,
    trusted: &Path,
    id: &str,
    root: &str,
) -> Result<Option<GitStatus>, String> {
    let Some(top) = top(Path::new(root)) else {
        return Ok(None);
    };
    guard(trusted, &top, false)?;
    let names = Names::new(root);
    let args = [
        "status",
        "--porcelain=v2",
        "-z",
        "--branch",
        "--untracked-files=all",
        "--",
        ".",
    ];
    let out = run(Path::new(root), &args, None)?;
    let text = String::from_utf8_lossy(&out);
    let mut entries = text.split('\0');
    let mut status = GitStatus {
        branch: None,
        upstream: None,
        ahead: 0,
        behind: 0,
        changes: Vec::new(),
    };
    while let Some(entry) = entries.next() {
        if let Some(head) = entry.strip_prefix("# branch.head ") {
            status.branch = (head != "(detached)").then(|| head.to_string());
            continue;
        }
        if let Some(upstream) = entry.strip_prefix("# branch.upstream ") {
            status.upstream = Some(upstream.to_string());
            continue;
        }
        // "+2 -1": two to push, one to pull.
        if let Some(ab) = entry.strip_prefix("# branch.ab ") {
            let mut counts = ab
                .split(' ')
                .map(|n| n.trim_start_matches(['+', '-']).parse().unwrap_or(0));
            status.ahead = counts.next().unwrap_or(0);
            status.behind = counts.next().unwrap_or(0);
            continue;
        }
        let kind = entry.get(..1).unwrap_or("");
        // Fields before the path: 1 → 8, 2 → 9 (then the old path), u → 10.
        let (fields, xy) = match kind {
            "1" => (8, entry.get(2..4).unwrap_or("")),
            "2" => (9, entry.get(2..4).unwrap_or("")),
            "u" => (10, entry.get(2..4).unwrap_or("")),
            "?" => (1, "??"),
            _ => continue,
        };
        let Some(rel) = entry.splitn(fields + 1, ' ').nth(fields) else {
            continue;
        };
        if kind == "2" {
            entries.next();
        }
        if status.changes.len() < MAX_CHANGES {
            if let Some(path) = shown(state, id, &names, &top, rel) {
                status.changes.push(GitChange {
                    path,
                    state: change_state(kind, xy).to_string(),
                    staged: kind != "?" && !xy.starts_with('.'),
                });
            }
        }
    }
    Ok(Some(status))
}

pub(super) fn log(
    state: &PluginsState,
    trusted: &Path,
    id: &str,
    root: &str,
    path: &str,
    limit: Option<u32>,
) -> Result<Vec<GitCommit>, String> {
    let Some(top) = top(Path::new(root)) else {
        return Ok(Vec::new());
    };
    guard(trusted, &top, false)?;
    let rel = from_top(state, id, root, &top, path)?;
    let names = Names::new(root);
    let count = format!("-n{}", limit.unwrap_or(100).clamp(1, MAX_LOG));
    let format = "--format=%x1e%H%x1f%ct%x1f%an%x1f%s";
    let args = [
        "log",
        "--follow",
        format,
        "--name-only",
        "-z",
        &count,
        "--",
        &rel,
    ];
    let out = run(&top, &args, None)?;
    let text = String::from_utf8_lossy(&out);
    Ok(text
        .split('\x1e')
        .filter_map(|record| {
            let mut parts = record.split('\0');
            let head: Vec<&str> = parts.next()?.splitn(4, '\x1f').collect();
            let file = parts.next()?.trim_start_matches('\n');
            let [hash, at, author, subject] = head.as_slice() else {
                return None;
            };
            Some(GitCommit {
                hash: hash.to_string(),
                at: at.parse::<f64>().ok()? * 1000.0,
                author: author.to_string(),
                subject: subject.to_string(),
                // A path the plugin may not read (renamed in from a hidden
                // folder) shows as the file it is now.
                path: shown(state, id, &names, &top, file).unwrap_or_else(|| path.to_string()),
            })
        })
        .collect())
}

fn is_hash(hash: &str) -> bool {
    (4..=64).contains(&hash.len()) && hash.chars().all(|c| c.is_ascii_hexdigit())
}

/// The file at `path` as commit `hash` had it; None when it had no such
/// file, or it isn't text.
pub(super) fn show(
    state: &PluginsState,
    trusted: &Path,
    id: &str,
    root: &str,
    hash: &str,
    path: &str,
) -> Result<Option<String>, String> {
    if !is_hash(hash) {
        return Err("A commit is named by its hash.".to_string());
    }
    let Some(top) = top(Path::new(root)) else {
        return Ok(None);
    };
    guard(trusted, &top, false)?;
    let rel = from_top(state, id, root, &top, path)?;
    let Ok(bytes) = run(&top, &["show", &format!("{hash}:{rel}")], None) else {
        return Ok(None);
    };
    if bytes.len() > MAX_SHOW_BYTES {
        return Err("The file is too large.".to_string());
    }
    Ok(String::from_utf8(bytes).ok())
}

/// Commits the files at `paths` (their changes only, whatever else is
/// staged) with `message`, as the user's git does; the new commit's hash.
pub(super) fn commit(
    state: &PluginsState,
    trusted: &Path,
    id: &str,
    root: &str,
    message: &str,
    paths: &[String],
) -> Result<String, String> {
    if !state.allows(id, "git.commit") {
        return Err(super::access::refused(id, "git.commit"));
    }
    if message.trim().is_empty() || paths.is_empty() {
        return Err("A commit needs a message and its files.".to_string());
    }
    let top = top(Path::new(root)).ok_or("The folder isn't in a Git repository.")?;
    guard(trusted, &top, true)?;
    // Files, each one named: a folder would bring along everything in it,
    // the hidden files no plugin may read too.
    if paths.iter().any(|p| Path::new(p).is_dir()) {
        return Err("A commit names its files, not a folder.".to_string());
    }
    let rels = paths
        .iter()
        .map(|p| from_top(state, id, root, &top, p))
        .collect::<Result<Vec<_>, _>>()?;
    let with = |command: &[&'static str]| {
        let mut args: Vec<&str> = command.to_vec();
        args.push("--");
        args.extend(rels.iter().map(String::as_str));
        args
    };
    run(&top, &with(&["add", "--all"]), None)?;
    run_within(
        &top,
        &with(&["commit", "--file=-", "--only"]),
        Some(message),
        COMMIT_TIME,
    )?;
    let head = run(&top, &["rev-parse", "HEAD"], None)?;
    Ok(String::from_utf8_lossy(&head).trim().to_string())
}

/// The repositories the writer trusts (safety.rs), in the app's data.
fn trusted_list(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use crate::app_dirs::AppDirs;
    use tauri::Manager;
    let data = app.path().own_data_dir().map_err(|e| e.to_string())?;
    Ok(data.join("git-trusted.json"))
}

/// The writer agreed to Git running what the repository of `root` sets up,
/// hooks included. Asked by the app itself, never on a plugin's word.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn git_trust_repository(app: tauri::AppHandle, root: String) -> Result<(), String> {
    let list = trusted_list(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let top = top(Path::new(&root)).ok_or("The folder isn't in a Git repository.")?;
        safety::trust(&list, &top, &safety::risks(&sources(&top), true))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A plugin's git call: the folder checked, then the work off the main thread.
async fn checked<T: Send + 'static>(
    app: &tauri::AppHandle,
    id: &str,
    root: &str,
    work: impl FnOnce(PluginsState, PathBuf) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    checked_root(app, id, root)?;
    let state = state::read(app);
    let trusted = trusted_list(app)?;
    tauri::async_runtime::spawn_blocking(move || work(state, trusted))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_git_status(
    app: tauri::AppHandle,
    id: String,
    root: String,
) -> Result<Option<GitStatus>, String> {
    checked(&app, &id.clone(), &root.clone(), move |s, t| {
        status(&s, &t, &id, &root)
    })
    .await
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_git_log(
    app: tauri::AppHandle,
    id: String,
    root: String,
    path: String,
    limit: Option<u32>,
) -> Result<Vec<GitCommit>, String> {
    checked(&app, &id.clone(), &root.clone(), move |s, t| {
        log(&s, &t, &id, &root, &path, limit)
    })
    .await
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_git_show(
    app: tauri::AppHandle,
    id: String,
    root: String,
    hash: String,
    path: String,
) -> Result<Option<String>, String> {
    checked(&app, &id.clone(), &root.clone(), move |s, t| {
        show(&s, &t, &id, &root, &hash, &path)
    })
    .await
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_git_commit(
    app: tauri::AppHandle,
    id: String,
    root: String,
    message: String,
    paths: Vec<String>,
) -> Result<String, String> {
    checked(&app, &id.clone(), &root.clone(), move |s, t| {
        commit(&s, &t, &id, &root, &message, &paths)
    })
    .await
}

/// Takes the remote's branches (git.sync).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_git_fetch(
    app: tauri::AppHandle,
    id: String,
    root: String,
) -> Result<(), String> {
    checked(&app, &id.clone(), &root.clone(), move |s, t| {
        remote::fetch(&s, &t, &id, &root)
    })
    .await
}

/// Sends the branch to its remote branch (git.sync).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_git_push(
    app: tauri::AppHandle,
    id: String,
    root: String,
) -> Result<(), String> {
    checked(&app, &id.clone(), &root.clone(), move |s, t| {
        remote::push(&s, &t, &id, &root)
    })
    .await
}

/// Takes the remote branch's commits in, undone on a conflict (git.sync).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_git_pull(
    app: tauri::AppHandle,
    id: String,
    root: String,
) -> Result<(), String> {
    checked(&app, &id.clone(), &root.clone(), move |s, t| {
        remote::pull(&s, &t, &id, &root)
    })
    .await
}

#[cfg(test)]
mod tests;
