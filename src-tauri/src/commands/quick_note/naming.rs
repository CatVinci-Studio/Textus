//! Quick Notes' text rules, with no file system in them: what a note's file
//! is called, how the one-file-per-day mode lays its entries out, and how a
//! continued entry is found again. mod.rs does the reading and writing.

use std::path::{Path, PathBuf};
use unicode_segmentation::UnicodeSegmentation;

/// The local date and time a note was saved at, as the frontend reads its
/// clock ("2026-10-19", "14:32"): Rust's standard library has no time zone,
/// and the user means their own wall clock. Mirrors `QuickNoteStamp` in
/// src/platform/ipc.ts. Checked before use, since both end up in file names.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct Stamp {
    pub date: String,
    pub time: String,
}

impl Stamp {
    pub fn is_valid(&self) -> bool {
        let digits = |s: &str, pattern: &str| {
            s.len() == pattern.len()
                && s.chars().zip(pattern.chars()).all(|(c, p)| match p {
                    'd' => c.is_ascii_digit(),
                    _ => c == p,
                })
        };
        digits(&self.date, "dddd-dd-dd") && digits(&self.time, "dd:dd")
    }

    /// `2026-10-19 1432`: the name of a note whose first line gives none.
    /// No colon - Windows forbids it in a file name.
    pub fn file_stem(&self) -> String {
        format!("{} {}", self.date, self.time.replace(':', ""))
    }

    /// `## 14:32`: the heading an entry of the day's file starts with.
    pub fn heading(&self) -> String {
        format!("## {}", self.time)
    }
}

/// How long a name taken from the first line may get, in characters as
/// the user counts them. A file name's limit is 255 bytes on every OS this
/// runs on; 60 CJK characters are 180 of them, with room for "-12.md".
const MAX_STEM_GRAPHEMES: usize = 60;

/// Names Windows reserves for devices, with or without an extension.
const WINDOWS_RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// A note as it is written: no blank lines before or after, one final line
/// break.
/// The first line keeps its indentation: in Markdown that can be a code
/// block.
pub fn normalize_note(text: &str) -> String {
    let mut rest = text;
    while let Some(newline) = rest.find('\n') {
        if !rest[..newline].trim().is_empty() {
            break;
        }
        rest = &rest[newline + 1..];
    }
    format!("{}\n", rest.trim_end())
}

/// The note's file stem: its first line with the Markdown taken off and
/// made safe for every OS, or the time when that leaves nothing.
pub fn note_stem(text: &str, stamp: &Stamp) -> String {
    let first = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let stem = sanitize_stem(&strip_markdown(first));
    if stem.is_empty() {
        stamp.file_stem()
    } else {
        stem
    }
}

/// One line of Markdown as plain words: block markers at the start (a
/// heading's #, a quote's >, a list's bullet or number, a task's box), then
/// links and images down to their text, then the inline markers.
pub fn strip_markdown(line: &str) -> String {
    let mut rest = line.trim();
    loop {
        let before = rest;
        rest = rest.trim_start_matches('>').trim_start();
        let hashes = rest.chars().take_while(|&c| c == '#').count();
        if (1..=6).contains(&hashes)
            && (hashes == rest.len() || rest[hashes..].starts_with([' ', '\t']))
        {
            rest = rest[hashes..].trim_start();
        }
        for bullet in ["- ", "* ", "+ "] {
            if let Some(after) = rest.strip_prefix(bullet) {
                rest = after.trim_start();
            }
        }
        let digits = rest.chars().take_while(char::is_ascii_digit).count();
        if digits > 0 && digits <= 9 {
            let after = &rest[digits..];
            if let Some(after) = after
                .strip_prefix(". ")
                .or_else(|| after.strip_prefix(") "))
            {
                rest = after.trim_start();
            }
        }
        for task in ["[ ] ", "[x] ", "[X] "] {
            if let Some(after) = rest.strip_prefix(task) {
                rest = after.trim_start();
            }
        }
        if rest == before {
            break;
        }
    }

    // [text](url) and ![alt](src) keep only what they show.
    let mut out = String::with_capacity(rest.len());
    let mut chars = rest.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        let image = c == '!' && rest[i + 1..].starts_with('[');
        if c == '[' || image {
            let open = if image { i + 1 } else { i };
            if let Some(close) = rest[open..].find("](").map(|n| open + n) {
                if let Some(end) = rest[close + 2..].find(')').map(|n| close + 2 + n) {
                    out.push_str(&rest[open + 1..close]);
                    while chars.peek().is_some_and(|&(j, _)| j <= end) {
                        chars.next();
                    }
                    continue;
                }
            }
        }
        out.push(c);
    }

    // HTML tags, then the inline delimiters.
    let mut plain = String::with_capacity(out.len());
    let mut in_tag = false;
    for c in out.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if in_tag => {}
            '*' | '_' | '~' | '=' | '`' => {}
            _ => plain.push(c),
        }
    }
    plain
}

/// `raw` as a file stem every OS accepts: no path separators or characters
/// Windows forbids, no control characters, no leading dots (a hidden file
/// on macOS and Linux), no trailing dots or spaces (Windows drops them), not
/// a reserved device name, and at most MAX_STEM_GRAPHEMES long. Empty when
/// nothing usable is left.
pub fn sanitize_stem(raw: &str) -> String {
    let replaced: String = raw
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                ' '
            } else {
                c
            }
        })
        .collect();
    let collapsed = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut stem: String = collapsed.graphemes(true).take(MAX_STEM_GRAPHEMES).collect();
    stem = stem
        .trim_start_matches(['.', ' '])
        .trim_end_matches(['.', ' '])
        .to_string();
    let device = stem.split('.').next().unwrap_or("").to_ascii_uppercase();
    if WINDOWS_RESERVED.contains(&device.as_str()) {
        stem.push('_');
    }
    stem
}

/// `dir/stem.md`, or `stem-2.md`, `stem-3.md`... - the first that `taken`
/// doesn't report as existing. `keep` is a path that may be reused (the note
/// being renamed, which is about to stop existing under its old name).
pub fn unique_path(
    dir: &Path,
    stem: &str,
    keep: Option<&Path>,
    taken: impl Fn(&Path) -> bool,
) -> PathBuf {
    let mut n = 1;
    loop {
        let name = if n == 1 {
            format!("{stem}.md")
        } else {
            format!("{stem}-{n}.md")
        };
        let candidate = dir.join(name);
        if keep == Some(candidate.as_path()) || !taken(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// The day's file in one-file-per-day mode.
pub fn day_file(dir: &Path, stamp: &Stamp) -> PathBuf {
    dir.join(format!("{}.md", stamp.date))
}

/// One entry of a day's file: its time as a heading, then the note.
pub fn entry_block(heading: &str, note: &str) -> String {
    format!("{heading}\n\n{}", normalize_note(note))
}

/// `existing` with `block` added at the end, one blank line between them
/// whatever `existing` ended with. Mirrored by joinEntry in
/// src/document/quick-note-merge.ts, which merges the same block into an
/// open document with unsaved edits - keep the two the same.
pub fn join_entry(existing: &str, block: &str) -> String {
    let kept = existing.trim_end();
    if kept.is_empty() {
        block.to_string()
    } else {
        format!("{kept}\n\n{block}")
    }
}

/// `day` with the entry under `heading` whose text is `base` replaced by
/// `note` - a continued note writing over its earlier self. The last such
/// entry if several match. None when the user has changed or removed that
/// entry since: the note then goes in as a new entry rather than over
/// something that is no longer what it wrote.
pub fn replace_entry(day: &str, heading: &str, base: &str, note: &str) -> Option<String> {
    let old = entry_block(heading, base);
    let old = old.trim_end();
    let mut found = None;
    let mut from = 0;
    while let Some(offset) = day[from..].find(old) {
        let start = from + offset;
        let end = start + old.len();
        let at_line_start = start == 0 || day[..start].ends_with('\n');
        let at_line_end = end == day.len() || day[end..].starts_with(['\n', '\r']);
        if at_line_start && at_line_end {
            found = Some((start, end));
        }
        from = start + 1;
        while !day.is_char_boundary(from) {
            from += 1;
        }
    }
    let (start, end) = found?;
    let new = entry_block(heading, note);
    Some(format!(
        "{}{}{}",
        &day[..start],
        new.trim_end(),
        &day[end..]
    ))
}

/// The text of the entry under `heading` that reads `text`, if the day's
/// file still has it - what continuing an entry starts from.
pub fn has_entry(day: &str, heading: &str, text: &str) -> bool {
    replace_entry(day, heading, text, text).is_some()
}

/// Line endings as the file already has them: a day's file the user saved
/// with CRLF keeps them.
pub fn in_line_endings_of(existing: &str, text: &str) -> String {
    if existing.contains("\r\n") {
        text.replace("\r\n", "\n").replace('\n', "\r\n")
    } else {
        text.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stamp() -> Stamp {
        Stamp {
            date: "2026-10-19".into(),
            time: "14:32".into(),
        }
    }

    #[test]
    fn a_note_is_named_after_its_first_line() {
        assert_eq!(note_stem("Buy milk\nand eggs", &stamp()), "Buy milk");
        assert_eq!(note_stem("\n\n  买牛奶  \n鸡蛋", &stamp()), "买牛奶");
    }

    #[test]
    fn markdown_markers_are_not_part_of_the_name() {
        assert_eq!(note_stem("# Meeting notes", &stamp()), "Meeting notes");
        assert_eq!(note_stem("> - [ ] **Call** Anna", &stamp()), "Call Anna");
        assert_eq!(note_stem("1. `cargo` ==test==", &stamp()), "cargo test");
        assert_eq!(
            note_stem("See [the plan](https://x.y/z) ![img](a.png)", &stamp()),
            "See the plan img"
        );
        assert_eq!(note_stem("<b>bold</b> ~~old~~", &stamp()), "bold old");
        // A hashtag is a word, not a heading.
        assert_eq!(note_stem("#idea for later", &stamp()), "#idea for later");
    }

    #[test]
    fn a_name_is_safe_on_every_os() {
        assert_eq!(
            sanitize_stem("a/b\\c:d*e?f\"g<h>i|j"),
            "a b c d e f g h i j"
        );
        assert_eq!(sanitize_stem("...hidden"), "hidden");
        assert_eq!(sanitize_stem("trailing. . "), "trailing");
        assert_eq!(sanitize_stem("tab\there\u{0007}"), "tab here");
        assert_eq!(sanitize_stem("CON"), "CON_");
        assert_eq!(sanitize_stem("nul.txt"), "nul.txt_");
        assert_eq!(sanitize_stem("Console"), "Console");
    }

    #[test]
    fn a_long_first_line_is_cut_to_a_sane_length() {
        let long = "字".repeat(200);
        let stem = sanitize_stem(&long);
        assert_eq!(stem.chars().count(), MAX_STEM_GRAPHEMES);
        assert!(stem.len() + "-99.md".len() < 255);
        // An emoji with a modifier is one character to the user; it is
        // never cut in half.
        let flags = "👍🏽".repeat(100);
        assert!(sanitize_stem(&flags).ends_with("👍🏽"));
    }

    #[test]
    fn a_note_with_no_usable_first_line_is_named_by_the_time() {
        assert_eq!(note_stem("", &stamp()), "2026-10-19 1432");
        assert_eq!(note_stem("   \n\t\n", &stamp()), "2026-10-19 1432");
        // An empty heading is an empty first line.
        assert_eq!(note_stem("# \nBody", &stamp()), "2026-10-19 1432");
        assert_eq!(note_stem("***", &stamp()), "2026-10-19 1432");
        assert!(!note_stem("", &stamp()).contains(':'));
    }

    #[test]
    fn a_taken_name_gets_a_number() {
        let dir = Path::new("/notes");
        let taken = [dir.join("Idea.md"), dir.join("Idea-2.md")];
        let exists = |p: &Path| taken.iter().any(|t| t == p);
        assert_eq!(
            unique_path(dir, "Idea", None, exists),
            dir.join("Idea-3.md")
        );
        assert_eq!(
            unique_path(dir, "Other", None, exists),
            dir.join("Other.md")
        );
        // The note's own current name is not a collision.
        assert_eq!(
            unique_path(dir, "Idea", Some(&dir.join("Idea.md")), exists),
            dir.join("Idea.md")
        );
    }

    #[test]
    fn stamps_are_checked_before_they_become_file_names() {
        assert!(stamp().is_valid());
        for (date, time) in [
            ("2026-10-19", "14:32:00"),
            ("../../etc", "14:32"),
            ("2026/10/19", "14:32"),
            ("2026-10-19", "1a:32"),
        ] {
            let bad = Stamp {
                date: date.into(),
                time: time.into(),
            };
            assert!(!bad.is_valid(), "{date} {time}");
        }
    }

    #[test]
    fn the_day_file_takes_entries_one_blank_line_apart() {
        let block = entry_block(&stamp().heading(), "First thought\n\n");
        assert_eq!(block, "## 14:32\n\nFirst thought\n");
        assert_eq!(join_entry("", &block), block);
        let day = join_entry(&block, &entry_block("## 15:00", "Second"));
        assert_eq!(day, "## 14:32\n\nFirst thought\n\n## 15:00\n\nSecond\n");
        // Whatever the file ended with - no newline, or several.
        assert_eq!(
            join_entry("Top", "## 15:00\n\nX\n"),
            "Top\n\n## 15:00\n\nX\n"
        );
        assert_eq!(
            join_entry("Top\n\n\n\n", "## 15:00\n\nX\n"),
            "Top\n\n## 15:00\n\nX\n"
        );
    }

    #[test]
    fn a_continued_entry_is_replaced_in_place() {
        let day = "## 09:00\n\nMorning\n\n## 14:32\n\nDraft\n\n## 16:00\n\nLater\n";
        assert_eq!(
            replace_entry(day, "## 14:32", "Draft", "Draft, finished").as_deref(),
            Some("## 09:00\n\nMorning\n\n## 14:32\n\nDraft, finished\n\n## 16:00\n\nLater\n")
        );
        // Changed by the user since: not found, so it isn't overwritten.
        assert_eq!(replace_entry(day, "## 14:32", "Drafty", "X"), None);
        // A prefix of a longer entry is not the entry.
        assert_eq!(replace_entry(day, "## 09:00", "Morn", "X"), None);
        assert!(has_entry(day, "## 16:00", "Later"));
    }

    #[test]
    fn crlf_day_files_keep_their_line_endings() {
        assert_eq!(in_line_endings_of("a\r\nb", "x\ny\n"), "x\r\ny\r\n");
        assert_eq!(in_line_endings_of("a\nb", "x\ny\n"), "x\ny\n");
    }

    #[test]
    fn a_note_is_written_without_surrounding_blank_lines() {
        assert_eq!(
            normalize_note("\n\n  hello\n  world  \n\n"),
            "  hello\n  world\n"
        );
    }
}
