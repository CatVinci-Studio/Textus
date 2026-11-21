//! The open folder's repository and its remote: fetch, push and pull, with
//! the user's own git and its credentials (a credential helper, an SSH
//! agent). Git is told to ask for nothing, so a remote that wants a password
//! typed fails, saying so. A pull that would leave conflicts is undone:
//! no document is left holding conflict markers.

use super::process::run_within;
use super::{guard, top, PluginsState};
use std::path::Path;
use std::time::Duration;

/// How long a call to the remote may take: a slow network, a large push.
const NETWORK_TIME: Duration = Duration::from_secs(180);

/// The permission all three need: what leaves or reaches this computer is
/// asked for apart from committing.
const SYNC: &str = "git.sync";

/// The repository's top, checked: the permission, a repository, and nothing
/// in it that runs without the writer's word (push and pull run hooks).
fn ready(
    state: &PluginsState,
    trusted: &Path,
    id: &str,
    root: &str,
) -> Result<std::path::PathBuf, String> {
    if !state.allows(id, SYNC) {
        return Err(super::super::access::refused(id, SYNC));
    }
    let top = top(Path::new(root)).ok_or("The folder isn't in a Git repository.")?;
    guard(trusted, &top, true)?;
    Ok(top)
}

/// What git said, put so the writer knows what to do: signing in is the
/// usual cause, and Textus never asks for a password itself.
fn explained(said: String) -> String {
    let lower = said.to_lowercase();
    let signing_in = [
        "authentication failed",
        "could not read username",
        "could not read password",
        "terminal prompts disabled",
        "permission denied (publickey",
        "host key verification failed",
    ];
    if signing_in.iter().any(|s| lower.contains(s)) {
        return format!(
            "Git couldn't sign in to the remote. Sign in once with Git in a terminal (or your Git app) so your credentials are saved, then try again.\n\n{said}"
        );
    }
    said
}

/// Takes the remote's branches, as `git fetch --prune` does.
pub(in crate::plugins) fn fetch(
    state: &PluginsState,
    trusted: &Path,
    id: &str,
    root: &str,
) -> Result<(), String> {
    let top = ready(state, trusted, id, root)?;
    run_within(&top, &["fetch", "--prune"], None, NETWORK_TIME).map_err(explained)?;
    Ok(())
}

/// Sends the branch to its remote branch; a branch with none yet goes to
/// `origin` under its own name and follows it from then on.
pub(in crate::plugins) fn push(
    state: &PluginsState,
    trusted: &Path,
    id: &str,
    root: &str,
) -> Result<(), String> {
    let top = ready(state, trusted, id, root)?;
    let tracked = run_within(
        &top,
        &["rev-parse", "--abbrev-ref", "@{upstream}"],
        None,
        NETWORK_TIME,
    )
    .is_ok();
    let args: &[&str] = if tracked {
        &["push"]
    } else {
        &["push", "--set-upstream", "origin", "HEAD"]
    };
    run_within(&top, args, None, NETWORK_TIME).map_err(explained)?;
    Ok(())
}

/// Takes the remote branch's commits into the branch, as the user's
/// `git pull` would (their merge or rebase setting). If that stops on a
/// conflict, it is undone and the folder is as it was.
pub(in crate::plugins) fn pull(
    state: &PluginsState,
    trusted: &Path,
    id: &str,
    root: &str,
) -> Result<(), String> {
    let top = ready(state, trusted, id, root)?;
    // A merge or rebase the user has under way is theirs: never undone here.
    if stopped(&git_dir(&top)) {
        return Err("A merge or rebase is under way in this folder. Finish or abort it with Git in a terminal (or your Git app), then pull.".to_string());
    }
    let Err(said) = run_within(&top, &["pull", "--no-edit"], None, NETWORK_TIME) else {
        return Ok(());
    };
    if undo_stopped(&top) {
        return Err(format!(
            "The remote's changes conflict with this folder's, so nothing was pulled. Resolve it with Git in a terminal (or your Git app).\n\n{said}"
        ));
    }
    Err(explained(said))
}

/// The repository's own folder (`.git`, or where a worktree's lives).
fn git_dir(top: &Path) -> std::path::PathBuf {
    run_within(top, &["rev-parse", "--git-dir"], None, NETWORK_TIME)
        .map(|out| top.join(String::from_utf8_lossy(&out).trim()))
        .unwrap_or_else(|_| top.join(".git"))
}

/// Whether a merge or rebase stands stopped in `git_dir`.
fn stopped(git_dir: &Path) -> bool {
    git_dir.join("MERGE_HEAD").exists()
        || git_dir.join("rebase-merge").exists()
        || git_dir.join("rebase-apply").exists()
}

/// Undoes a merge or rebase a pull left stopped; whether there was one.
fn undo_stopped(top: &Path) -> bool {
    let git_dir = git_dir(top);
    if git_dir.join("MERGE_HEAD").exists() {
        let _ = run_within(top, &["merge", "--abort"], None, NETWORK_TIME);
        return true;
    }
    if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
        let _ = run_within(top, &["rebase", "--abort"], None, NETWORK_TIME);
        return true;
    }
    false
}

#[cfg(test)]
#[path = "remote_tests.rs"]
mod tests;
