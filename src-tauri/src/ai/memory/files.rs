//! The small pieces a memory file is made of: its name from its text, a
//! free path, its id, its timestamp, and one atomic write.

use super::*;

/// Whether `alias` is too short to stand for a name: one CJK character (晚 for
/// 林晚 would match every 晚上), or one or two letters.
pub(crate) fn too_short_an_alias(alias: &str) -> bool {
    let chars = alias.chars().count();
    let unspaced = alias
        .chars()
        .any(|c| matches!(c, '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{9fff}'));
    chars == 0 || (unspaced && chars < 2) || (!unspaced && chars < 3)
}

/// What a duplicate check compares: the letters and digits, lowercased,
/// with full-width forms folded - "Keep it short." and "keep it short"
/// are one memory.
pub(crate) fn normalized(text: &str) -> String {
    text.chars()
        .map(crate::ai::tools::normalize_char)
        .flat_map(char::to_lowercase)
        .filter(|c| c.is_alphanumeric())
        .collect()
}

pub(crate) fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A short, readable file stem from a memory's first words.
pub(crate) fn memory_stem(text: &str) -> String {
    let stem = safe_file_stem(text, "memory", 48);
    let mut out = String::new();
    for c in stem.chars() {
        if !(c == '-' && out.ends_with('-')) {
            out.push(c);
        }
    }
    out.trim_matches('-').to_string()
}

/// `<dir>/<stem>.md`, or `<stem>-2.md` and on when that is taken.
pub(crate) fn free_path(dir: &Path, stem: &str) -> PathBuf {
    dir.join(crate::ids::free_name(
        dir,
        &format!("{stem}.md"),
        crate::ids::Numbered::Dash,
    ))
}

pub(crate) fn file_stem(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

pub(crate) fn id_of(scope: Scope, folder: &str, path: &Path) -> String {
    format!("{}/{folder}/{}", scope.as_str(), file_stem(path))
}

pub(crate) fn write(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    crate::atomic::write_sync(path, content).map_err(|e| e.to_string())
}

/// Now, as `2026-10-18T09:30:00Z` (UTC).
pub(crate) fn now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    timestamp(secs)
}

pub(crate) fn timestamp(secs: u64) -> String {
    chrono::DateTime::from_timestamp(secs as i64, 0)
        .unwrap_or_default()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}
