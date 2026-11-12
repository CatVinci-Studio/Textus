//! Ids that name a file or a folder: short, of a few characters only, so
//! one can never climb out of where it is kept.

/// Whether `id` has 1 to `max` characters, each one `allowed`.
/// `bytes` as lowercase hex.
pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A file name for what is kept per path (a document's undo, its notes):
/// the first `bytes` of the path's SHA-256, in hex.
pub(crate) fn path_key(path: &str, bytes: usize) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(path.as_bytes());
    hex(&digest[..bytes.min(digest.len())])
}

/// How a taken name is numbered: `notes-2.md` or `report (2).pdf`.
#[derive(Clone, Copy)]
pub(crate) enum Numbered {
    Dash,
    Paren,
}

/// `name` numbered `n`, before its extension; `n` 0 is `name` itself.
pub(crate) fn numbered(name: &str, n: usize, style: Numbered) -> String {
    if n == 0 {
        return name.to_string();
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")),
        _ => (name, String::new()),
    };
    match style {
        Numbered::Dash => format!("{stem}-{n}{ext}"),
        Numbered::Paren => format!("{stem} ({n}){ext}"),
    }
}

/// `name`, or the first of it numbered from 2 that `dir` hasn't.
pub(crate) fn free_name(dir: &std::path::Path, name: &str, style: Numbered) -> String {
    (0..)
        .filter(|&n| n != 1)
        .map(|n| numbered(name, n, style))
        .find(|candidate| !dir.join(candidate).exists())
        .unwrap_or_else(|| name.to_string())
}

pub(crate) fn safe_id(id: &str, max: usize, allowed: impl Fn(char) -> bool) -> bool {
    !id.is_empty() && id.len() <= max && id.chars().all(allowed)
}

/// Lowercase ASCII letters and digits.
pub(crate) fn lower_alnum(c: char) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit()
}

/// A name typed for one file or folder: trimmed, one path component that
/// can't walk out of the folder it is meant for; None otherwise.
pub(crate) fn one_name(name: &str) -> Option<&str> {
    let name = name.trim();
    (!name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\'])).then_some(name)
}

/// `one_name`, or the error a typed name gets.
pub(crate) fn typed_name(name: &str) -> Result<&str, String> {
    one_name(name).ok_or_else(|| crate::errors::error("badName"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_typed_name_is_one_trimmed_component() {
        assert_eq!(one_name("  笔记 2.md "), Some("笔记 2.md"));
        for bad in ["", "  ", ".", "..", "a/b", "a\\b", "../x"] {
            assert!(one_name(bad).is_none(), "{bad:?} should be refused");
        }
    }
}
