//! The few ways other apps write their folder settings, read just far enough
//! for the keys Textus follows: JSON with comments (VS Code), a flat key on
//! one line of YAML, TOML or EDN, and four date-format syntaxes. No parser
//! crates: a setting we can't find falls back, nothing more.

use std::path::Path;

/// How much of a settings file is read.
const MAX_BYTES: u64 = 256 * 1024;

pub(crate) fn read(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_BYTES {
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    Some(text.strip_prefix('\u{feff}').unwrap_or(&text).to_string())
}

/// JSON, or VS Code's JSON with comments and trailing commas.
pub(crate) fn json(path: &Path) -> Option<serde_json::Value> {
    let text = read(path)?;
    serde_json::from_str(&text)
        .ok()
        .or_else(|| serde_json::from_str(&strip_jsonc(&text)).ok())
        .filter(|v: &serde_json::Value| v.is_object())
}

/// `text` without `//` and `/* */` comments and trailing commas, strings
/// left alone.
fn strip_jsonc(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_string = false;
    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            if c == '\\' {
                out.extend(chars.next());
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match (c, chars.peek()) {
            ('"', _) => {
                in_string = true;
                out.push(c);
            }
            ('/', Some('/')) => {
                for c in chars.by_ref() {
                    if c == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            ('/', Some('*')) => {
                chars.next();
                let mut last = ' ';
                for c in chars.by_ref() {
                    if last == '*' && c == '/' {
                        break;
                    }
                    last = c;
                }
            }
            _ => out.push(c),
        }
    }
    // A comma before a closing bracket.
    let mut cleaned = String::with_capacity(out.len());
    let bytes: Vec<char> = out.chars().collect();
    for (i, &c) in bytes.iter().enumerate() {
        if c == ',' {
            let next = bytes[i + 1..].iter().find(|c| !c.is_whitespace());
            if matches!(next, Some('}') | Some(']')) {
                continue;
            }
        }
        cleaned.push(c);
    }
    cleaned
}

/// The string at `key` in a JSON object, path parts split by ".".
pub(crate) fn json_str(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .or_else(|| key.split('.').try_fold(value, |v, part| v.get(part)))
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

pub(crate) fn json_bool(value: &serde_json::Value, key: &str) -> Option<bool> {
    value.get(key).and_then(|v| v.as_bool())
}

/// The value of a top-level `key` written on one line - YAML `key: value`,
/// TOML `key = "value"`, EDN `:key "value"` - quotes dropped; comments
/// (`#`, `;`) skipped.
pub(crate) fn flat_key(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|line| {
        // An EDN map may open on the key's line.
        let line = line.trim().trim_start_matches('{').trim_start();
        if line.starts_with('#') || line.starts_with(';') {
            return None;
        }
        let rest = line.strip_prefix(key)?.trim_start();
        let rest = rest
            .strip_prefix(':')
            .or_else(|| rest.strip_prefix('='))
            .unwrap_or(if key.starts_with(':') { rest } else { "" })
            .trim();
        // A quoted value ends at its closing quote; a bare one at a comment.
        let value = match rest.chars().next() {
            Some(q @ ('"' | '\'')) => rest[1..].split(q).next()?,
            _ => rest.split(" #").next()?.trim().trim_end_matches([',', '}']),
        }
        .trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

/// A date format in another app's tokens, as moment.js writes it (what
/// Obsidian uses and the plugins' shared dates read).
pub(crate) fn moment_format(format: &str, syntax: DateSyntax) -> String {
    let table: &[(&str, &str)] = match syntax {
        // date-fns (Logseq) and Luxon (Dendron) share these.
        DateSyntax::Unicode => &[
            ("yyyy", "YYYY"),
            ("yy", "YY"),
            ("y", "YYYY"),
            ("EEEE", "dddd"),
            ("EEE", "ddd"),
            ("do", "Do"),
            ("dd", "DD"),
            ("d", "D"),
        ],
        // The `dateformat` library (Foam's old settings).
        DateSyntax::DateFormat => &[
            ("yyyy", "YYYY"),
            ("yy", "YY"),
            ("dddd", "dddd"),
            ("ddd", "ddd"),
            ("mmmm", "MMMM"),
            ("mmm", "MMM"),
            ("mm", "MM"),
            ("dd", "DD"),
            ("d", "D"),
        ],
    };
    let mut out = String::new();
    let mut rest = format;
    'outer: while !rest.is_empty() {
        // Quoted text stays as it is, in moment's brackets.
        if let Some(quoted) = rest.strip_prefix('\'') {
            let end = quoted.find('\'').unwrap_or(quoted.len());
            out.push_str(&format!("[{}]", &quoted[..end]));
            rest = quoted.get(end + 1..).unwrap_or("");
            continue;
        }
        for (from, to) in table {
            if let Some(after) = rest.strip_prefix(from) {
                out.push_str(to);
                rest = after;
                continue 'outer;
            }
        }
        let c = rest.chars().next().unwrap_or_default();
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    out
}

#[derive(Clone, Copy)]
pub(crate) enum DateSyntax {
    Unicode,
    DateFormat,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_json_with_comments_and_trailing_commas() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            "{\n // a note\n \"a\": \"x // not a comment\", /* gone */\n \"b\": true,\n}",
        )
        .unwrap();
        let v = json(&path).unwrap();
        assert_eq!(json_str(&v, "a").as_deref(), Some("x // not a comment"));
        assert_eq!(json_bool(&v, "b"), Some(true));
    }

    #[test]
    fn reads_a_flat_key_in_yaml_toml_and_edn() {
        assert_eq!(
            flat_key("docs_dir: 'site' # x\n", "docs_dir").as_deref(),
            Some("site")
        );
        assert_eq!(
            flat_key("staticDir = \"public\"\n", "staticDir").as_deref(),
            Some("public")
        );
        assert_eq!(
            flat_key(
                " ;; :journals-directory \"x\"\n :journals-directory \"daily\"\n",
                ":journals-directory"
            )
            .as_deref(),
            Some("daily")
        );
        assert_eq!(flat_key("other: 1\n", "docs_dir"), None);
    }

    #[test]
    fn writes_other_date_formats_as_moment() {
        assert_eq!(
            moment_format("yyyy_MM_dd", DateSyntax::Unicode),
            "YYYY_MM_DD"
        );
        assert_eq!(
            moment_format("MMM do, yyyy", DateSyntax::Unicode),
            "MMM Do, YYYY"
        );
        assert_eq!(moment_format("y.MM.dd", DateSyntax::Unicode), "YYYY.MM.DD");
        assert_eq!(
            moment_format("yyyy-mm-dd", DateSyntax::DateFormat),
            "YYYY-MM-DD"
        );
        assert_eq!(moment_format("'week' w", DateSyntax::Unicode), "[week] w");
    }
}
