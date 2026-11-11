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
