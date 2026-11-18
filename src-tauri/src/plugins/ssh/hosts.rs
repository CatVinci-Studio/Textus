//! The hosts the user's `~/.ssh/config` names, for a plugin to offer: each
//! `Host` without a pattern, through `Include`d files. Read only; ssh itself
//! reads the config again on each connection, with everything it says.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// How deep `Include`s are followed.
const MAX_DEPTH: usize = 8;

/// The named hosts in `config` (and what it includes, from `ssh_dir`).
pub(crate) fn hosts_in(config: &Path, ssh_dir: &Path) -> Vec<String> {
    let mut found = BTreeSet::new();
    read(config, ssh_dir, 0, &mut found);
    found.into_iter().collect()
}

fn read(file: &Path, ssh_dir: &Path, depth: usize, found: &mut BTreeSet<String>) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(text) = std::fs::read_to_string(file) else {
        return;
    };
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        let mut words = line.split_whitespace();
        let Some(first) = words.next() else { continue };
        // `Host=name` as well as `Host name`.
        let (key, inline) = match first.split_once('=') {
            Some((key, value)) => (key, Some(value)),
            None => (first, None),
        };
        let values: Vec<&str> = inline
            .filter(|v| !v.is_empty())
            .into_iter()
            .chain(words)
            .collect();
        if key.eq_ignore_ascii_case("host") {
            for name in values {
                if !name.contains(['*', '?', '!']) && super::link::valid_host(name) {
                    found.insert(name.to_string());
                }
            }
        } else if key.eq_ignore_ascii_case("include") {
            for pattern in values {
                for path in included(pattern, ssh_dir) {
                    read(&path, ssh_dir, depth + 1, found);
                }
            }
        }
    }
}

/// An `Include` pattern's files: `~` the home, relative to `~/.ssh`, a `*`
/// in the file name matching any run of characters.
fn included(pattern: &str, ssh_dir: &Path) -> Vec<PathBuf> {
    let path = match pattern.strip_prefix("~/") {
        Some(rest) => ssh_dir
            .parent()
            .map_or_else(|| PathBuf::from(rest), |h| h.join(rest)),
        None => ssh_dir.join(pattern),
    };
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned());
    let Some(name) = name.filter(|n| n.contains('*')) else {
        return vec![path];
    };
    let Some(dir) = path.parent() else {
        return vec![];
    };
    let parts: Vec<&str> = name.split('*').collect();
    let mut out: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .is_some_and(|n| matches(&n.to_string_lossy(), &parts))
        })
        .collect();
    out.sort();
    out
}

fn matches(name: &str, parts: &[&str]) -> bool {
    let (Some(first), Some(last)) = (parts.first(), parts.last()) else {
        return false;
    };
    if !name.starts_with(first) || !name.ends_with(last) || name.len() < first.len() + last.len() {
        return false;
    }
    let mut rest = &name[first.len()..name.len() - last.len()];
    for part in &parts[1..parts.len() - 1] {
        match rest.find(part) {
            Some(at) => rest = &rest[at + part.len()..],
            None => return false,
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_named_hosts_through_includes() {
        let dir = tempfile::tempdir().unwrap();
        let ssh = dir.path().join(".ssh");
        std::fs::create_dir_all(ssh.join("conf.d")).unwrap();
        std::fs::write(
            ssh.join("config"),
            "# mine\nHost work box-1\n  HostName 10.0.0.1\nHost *.lan !x\nInclude conf.d/*.conf\nHost=gpu\n",
        )
        .unwrap();
        std::fs::write(
            ssh.join("conf.d/a.conf"),
            "Host lab\nHost -oProxyCommand=x\n",
        )
        .unwrap();
        std::fs::write(ssh.join("conf.d/b.txt"), "Host skipped\n").unwrap();
        assert_eq!(
            hosts_in(&ssh.join("config"), &ssh),
            vec!["box-1", "gpu", "lab", "work"]
        );
    }
}
