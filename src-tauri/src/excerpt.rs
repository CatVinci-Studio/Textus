//! A long line or turn shown around what was searched for: a few words
//! before the first match, more after, … where it was cut. One rule for
//! the Search page, plugins' workspace search and conversation history.

/// Characters kept before the match, and after it.
const BEFORE: usize = 24;
const AFTER: usize = 100;

/// `text` around the first `term` in `lower` (`text` lowercased), on one
/// line.
pub fn around(text: &str, lower: &str, term: &str) -> String {
    let at = lower.find(term).unwrap_or(0);
    // Byte offsets in the lowercased text may not match the original's, so
    // count characters.
    let at_char = lower[..at].chars().count();
    let chars: Vec<char> = text.chars().collect();
    let start = at_char.saturating_sub(BEFORE).min(chars.len());
    let end = (at_char + term.chars().count() + AFTER).min(chars.len());
    let mut out = chars[start..end]
        .iter()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if start > 0 {
        out.insert(0, '…');
    }
    if end < chars.len() {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::around;

    #[test]
    fn a_short_line_is_whole_and_a_long_one_shows_its_match() {
        let short = "Write the urban renewal notes";
        assert_eq!(around(short, &short.to_lowercase(), "urban"), short);
        let long = format!(
            "{} urban renewal {}",
            "word ".repeat(40),
            "tail ".repeat(40)
        );
        let shown = around(&long, &long.to_lowercase(), "urban");
        assert!(shown.starts_with('…') && shown.ends_with('…'));
        assert!(shown.find("urban").unwrap() < 30);
    }
}
