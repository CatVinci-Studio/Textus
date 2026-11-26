//! What stands between a folder's own Git settings and a program run on this
//! computer. A repository's `.git/config` can name programs Git starts by
//! itself (a filter on `git status`, a file-system monitor, a hook on
//! commit), and a folder that came from elsewhere - an archive, a shared or
//! synced folder - brings its `.git` along. Two guards: the settings Git can
//! be told to ignore are switched off on every call, and a repository that
//! sets any of the rest runs no Git until the writer says they trust it.

use std::path::{Path, PathBuf};

/// Settings switched off on every call: none of what Textus asks of Git
/// needs them.
pub(super) const QUIET: &[&str] = &[
    "-c",
    "core.fsmonitor=false",
    "-c",
    "safe.bareRepository=explicit",
    "-c",
    "diff.external=",
    "-c",
    "core.pager=cat",
    // `ext::` remotes run a command; none of what Textus fetches needs one.
    "-c",
    "protocol.ext.allow=never",
];

/// The start of the error a call gives in a repository not trusted yet;
/// what it would run follows.
pub(super) const UNTRUSTED: &str = "git-untrusted: ";

/// One `key = value` of a Git config file, its section and key lowercased
/// (`filter.lfs.clean`: section "filter", key "clean").
fn settings(text: &str) -> Vec<(String, String, String)> {
    let mut section = String::new();
    let mut found = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if let Some(head) = line.strip_prefix('[') {
            let name = head.split([' ', '"', ']', '.']).next().unwrap_or("");
            section = name.to_ascii_lowercase();
            continue;
        }
        let (key, value) = line.split_once('=').unwrap_or((line, "true"));
        found.push((
            section.clone(),
            key.trim().to_ascii_lowercase(),
            value.trim().to_string(),
        ));
    }
    found
}

/// Whether a setting makes Git start a program, or read more settings from
/// a file of the repository's choosing.
fn runs_a_program(section: &str, key: &str, value: &str) -> bool {
    match (section, key) {
        // The built-in monitor (true) and none (false) run nothing of the
        // repository's.
        ("core", "fsmonitor") => !matches!(value, "true" | "false" | ""),
        ("core", "hookspath" | "sshcommand" | "editor" | "pager" | "askpass" | "gitproxy") => true,
        ("filter", "clean" | "smudge" | "process") => true,
        ("diff", "external" | "textconv" | "command") => true,
        ("merge", "driver") => true,
        ("gpg", "program") => true,
        ("credential", "helper") => true,
        // Fetch and push start these on a local remote, through a shell.
        ("remote", "uploadpack" | "receivepack") => true,
        // `protocol.ext.allow` (or `protocol.allow`) lets an `ext::` remote
        // run its command.
        ("protocol", "allow") => true,
        ("sequence", "editor") => true,
        ("include" | "includeif", "path") => true,
        ("alias" | "pager", _) => true,
        _ => false,
    }
}

/// The repository's own files Git reads settings and hooks from.
pub(super) struct Sources {
    pub configs: Vec<PathBuf>,
    pub hooks: PathBuf,
}

/// What `sources` would make Git run, named for the writer: settings as
/// `section.key`, hooks as `hook: name`. `committing` counts the hooks,
/// which only a commit runs. Empty for a repository that runs nothing.
pub(super) fn risks(sources: &Sources, committing: bool) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    for config in &sources.configs {
        let Ok(text) = std::fs::read_to_string(config) else {
            continue;
        };
        for (section, key, value) in settings(&text) {
            if runs_a_program(&section, &key, &value) {
                found.push(format!("{section}.{key}"));
            }
        }
    }
    if committing {
        found.extend(hooks_in(&sources.hooks));
    }
    found.sort();
    found.dedup();
    found
}

/// The hooks a commit would run: the files there that aren't Git's samples.
fn hooks_in(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| !kind.is_dir()))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| !name.ends_with(".sample") && !name.starts_with('.'))
        .map(|name| format!("hook: {name}"))
        .collect()
}

/// The repositories the writer trusts, by their top folder, each with what
/// it ran when they said so: one that gains a new setting is asked about
/// again.
pub(super) fn trusted(store: &Path, top: &Path, risks: &[String]) -> bool {
    let all: std::collections::HashMap<String, Vec<String>> = std::fs::read_to_string(store)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    all.get(top.to_string_lossy().as_ref())
        .is_some_and(|known| risks.iter().all(|risk| known.contains(risk)))
}

pub(super) fn trust(store: &Path, top: &Path, risks: &[String]) -> Result<(), String> {
    let mut all: std::collections::HashMap<String, Vec<String>> = std::fs::read_to_string(store)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    let known = all.entry(top.to_string_lossy().to_string()).or_default();
    for risk in risks {
        if !known.contains(risk) {
            known.push(risk.clone());
        }
    }
    let text = serde_json::to_string_pretty(&all).map_err(|e| e.to_string())?;
    if let Some(dir) = store.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(store, text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sources(dir: &Path, config: &str) -> Sources {
        std::fs::create_dir_all(dir.join("hooks")).unwrap();
        std::fs::write(dir.join("config"), config).unwrap();
        Sources {
            configs: vec![dir.join("config")],
            hooks: dir.join("hooks"),
        }
    }

    #[test]
    fn an_everyday_repository_runs_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let config = "[core]\n\trepositoryformatversion = 0\n\tfsmonitor = true\n\
            [remote \"origin\"]\n\turl = git@example.com:a/b.git\n\
            [branch \"main\"]\n\tremote = origin\n[user]\n\tname = A\n";
        let from = sources(dir.path(), config);
        std::fs::write(from.hooks.join("pre-commit.sample"), "").unwrap();
        assert!(risks(&from, true).is_empty());
    }

    #[test]
    fn settings_that_start_a_program_are_named() {
        let dir = tempfile::tempdir().unwrap();
        let config = "[core]\n  fsmonitor = /tmp/run.sh\n  sshCommand = evil\n\
            [filter \"x\"]\n  clean = cat /etc/passwd\n  required\n\
            # [diff]\n; external = no\n[include]\n  path = ../other\n\
            [alias]\n  st = !sh -c id\n";
        let from = sources(dir.path(), config);
        assert_eq!(
            risks(&from, false),
            [
                "alias.st",
                "core.fsmonitor",
                "core.sshcommand",
                "filter.clean",
                "include.path"
            ]
        );
    }

    #[test]
    fn hooks_count_for_a_commit_only() {
        let dir = tempfile::tempdir().unwrap();
        let from = sources(dir.path(), "[core]\n\tbare = false\n");
        std::fs::write(from.hooks.join("pre-commit"), "#!/bin/sh\n").unwrap();
        assert!(risks(&from, false).is_empty());
        assert_eq!(risks(&from, true), ["hook: pre-commit"]);
    }

    #[test]
    fn trust_is_for_what_a_repository_ran_then() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("deep/trusted.json");
        let top = Path::new("/work/notes");
        let filter = vec!["filter.clean".to_string()];
        assert!(!trusted(&store, top, &filter));
        trust(&store, top, &filter).unwrap();
        assert!(trusted(&store, top, &filter));
        assert!(!trusted(&store, Path::new("/work/other"), &filter));
        // A setting it gained since is asked about again.
        let more = vec!["filter.clean".to_string(), "core.sshcommand".to_string()];
        assert!(!trusted(&store, top, &more));
        trust(&store, top, &more).unwrap();
        assert!(trusted(&store, top, &more) && trusted(&store, top, &filter));
    }
}
