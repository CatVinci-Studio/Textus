//! A JSON file Textus keeps: read back, or, when it no longer parses, moved
//! aside for recovery by hand so a fresh one can take its place - one bad
//! byte never locks the user out of what the file held.

use serde::de::DeserializeOwned;
use std::path::{Path, PathBuf};

/// `path` read as `T`; None when it isn't there, or when it doesn't parse
/// (then moved aside first).
pub(crate) fn read_or_set_aside<T: DeserializeOwned>(path: &Path) -> Option<T> {
    parse_or_set_aside(path, &std::fs::read(path).ok()?)
}

/// `bytes` (read from `path`) as `T`, or None with `path` moved aside.
pub(crate) fn parse_or_set_aside<T: DeserializeOwned>(path: &Path, bytes: &[u8]) -> Option<T> {
    match serde_json::from_slice(bytes) {
        Ok(value) => Some(value),
        Err(error) => {
            match set_aside(path) {
                Ok(moved) => eprintln!(
                    "textus: {} is not valid JSON ({error}); moved it to {}",
                    path.display(),
                    moved.display()
                ),
                Err(e) => eprintln!("textus: cannot move aside {}: {e}", path.display()),
            }
            None
        }
    }
}

/// `path` moved aside, for a file that can't be used as it is.
pub(crate) fn move_aside(path: &Path) {
    if let Err(e) = set_aside(path) {
        eprintln!("textus: cannot move aside {}: {e}", path.display());
    }
}

/// Renames `path` to the first free `<name>.corrupt-<n>` beside it.
fn set_aside(path: &Path) -> std::io::Result<PathBuf> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut n = 1u32;
    loop {
        let candidate = path.with_file_name(format!("{name}.corrupt-{n}"));
        if !candidate.exists() {
            std::fs::rename(path, &candidate)?;
            return Ok(candidate);
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_broken_file_is_kept_aside_beside_earlier_ones_and_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("provider_keys.json");
        // An earlier casualty already holds the first slot.
        std::fs::write(dir.path().join("provider_keys.json.corrupt-1"), "old").unwrap();
        std::fs::write(&path, "{\"openai\": \"sk-").unwrap();
        assert!(read_or_set_aside::<serde_json::Value>(&path).is_none());
        assert!(!path.exists());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("provider_keys.json.corrupt-2")).unwrap(),
            "{\"openai\": \"sk-"
        );
        std::fs::write(&path, "{\"a\":1}").unwrap();
        assert!(read_or_set_aside::<serde_json::Value>(&path).is_some());
    }
}
