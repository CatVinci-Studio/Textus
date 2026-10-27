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
    let mut path = dir.join(format!("{stem}.md"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem}-{n}.md"));
        n += 1;
    }
    path
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
    // Days to a civil date: Howard Hinnant's days_from_civil, inverted.
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3_600,
        rem % 3_600 / 60,
        rem % 60
    )
}
