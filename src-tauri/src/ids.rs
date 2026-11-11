//! Ids that name a file or a folder: short, of a few characters only, so
//! one can never climb out of where it is kept.

/// Whether `id` has 1 to `max` characters, each one `allowed`.
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
