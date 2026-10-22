//! The frontmatter of a skill file or a library entry: the small YAML
//! subset Textus reads (scalars, lists, folded and literal blocks).

use super::*;

/// A skill file's frontmatter: the top-level `key: value` pairs and the
/// `metadata:` map's (Agent Skills keeps tool-specific keys there, string
/// values only).
#[derive(Default, Debug)]
pub(crate) struct Frontmatter {
    pub fields: BTreeMap<String, String>,
    pub metadata: BTreeMap<String, String>,
}

/// Splits a skill file into its frontmatter and body. No frontmatter (or an
/// unterminated one) means the whole file is the body. Tolerates a BOM and
/// CRLF line ends.
pub(crate) fn split_frontmatter(content: &str) -> (Option<Frontmatter>, String) {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let lines: Vec<&str> = content.split('\n').collect();
    let is_fence = |line: &str| line.trim_end_matches('\r').trim_end() == "---";
    if lines.first().is_none_or(|l| !is_fence(l)) {
        return (None, content.to_string());
    }
    let Some(close) = lines
        .iter()
        .skip(1)
        .position(|l| is_fence(l) || l.trim_end_matches('\r').trim_end() == "...")
        .map(|i| i + 1)
    else {
        return (None, content.to_string());
    };
    let header: Vec<String> = lines[1..close]
        .iter()
        .map(|l| l.trim_end_matches('\r').to_string())
        .collect();
    let body = lines[close + 1..].join("\n");
    let mut fm = Frontmatter::default();
    for (key, value) in parse_yaml_map(&header) {
        match value {
            YamlValue::Scalar(v) => {
                fm.fields.insert(key, v);
            }
            YamlValue::Map(lines) if key == "metadata" => {
                for (k, v) in parse_yaml_map(&dedent(&lines)) {
                    if let YamlValue::Scalar(v) = v {
                        fm.metadata.insert(k, v);
                    }
                }
            }
            YamlValue::Map(_) => {}
        }
    }
    (Some(fm), body)
}

pub(crate) enum YamlValue {
    Scalar(String),
    /// A nested block (a map or a list), as its raw lines.
    Map(Vec<String>),
}

/// The small subset of YAML skill frontmatter uses: `key: value` at the
/// block's left edge; plain, single- and double-quoted scalars (plain ones
/// may continue on indented lines); block scalars (`|`, `>`, with `-`/`+`
/// chomping); and nested blocks, returned raw. Comments and anything else
/// are skipped. Hand-written rather than a YAML dependency: this is all a
/// skill file needs, and a mistake in one only costs that file's metadata.
pub(crate) fn parse_yaml_map(lines: &[String]) -> Vec<(String, YamlValue)> {
    let indented = |l: &str| l.starts_with(' ') || l.starts_with('\t');
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = &lines[i];
        i += 1;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || indented(line) {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim().to_string();
        let value = value.trim();
        // The block under this key: every following indented or blank line.
        let start = i;
        while i < lines.len() && (lines[i].trim().is_empty() || indented(&lines[i])) {
            i += 1;
        }
        let mut block: Vec<String> = lines[start..i].to_vec();
        while block.last().is_some_and(|l| l.trim().is_empty()) {
            block.pop();
        }
        let value = match value {
            "" => {
                let nested = block.iter().find(|l| !l.trim().is_empty());
                match nested {
                    None => YamlValue::Scalar(String::new()),
                    Some(first) if first.trim_start().starts_with("- ") || first.contains(':') => {
                        YamlValue::Map(block)
                    }
                    Some(_) => YamlValue::Scalar(fold_plain("", &block)),
                }
            }
            v if v.starts_with('|') || v.starts_with('>') => {
                let text = dedent(&block);
                YamlValue::Scalar(if v.starts_with('|') {
                    text.join("\n").trim_end().to_string()
                } else {
                    fold_lines(&text)
                })
            }
            v if v.starts_with('"') || v.starts_with('\'') => {
                let mut raw = v.to_string();
                for l in &block {
                    raw.push(' ');
                    raw.push_str(l.trim());
                }
                YamlValue::Scalar(unquote(&raw))
            }
            v => YamlValue::Scalar(fold_plain(v, &block)),
        };
        out.push((key, value));
    }
    out
}

/// A plain scalar and its continuation lines, folded into one line, minus a
/// trailing ` # comment`.
pub(crate) fn fold_plain(first: &str, rest: &[String]) -> String {
    let mut parts: Vec<&str> = vec![first];
    parts.extend(rest.iter().map(|l| l.trim()));
    let joined = parts
        .into_iter()
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    match joined.find(" #") {
        Some(at) => joined[..at].trim_end().to_string(),
        None => joined,
    }
}

/// Folded block scalar (`>`): lines join with spaces, a blank line becomes
/// a line break.
pub(crate) fn fold_lines(lines: &[String]) -> String {
    let mut out = String::new();
    let mut pending_break = false;
    for line in lines {
        let line = line.trim_end();
        if line.is_empty() {
            pending_break = true;
            continue;
        }
        if !out.is_empty() {
            out.push(if pending_break { '\n' } else { ' ' });
        }
        pending_break = false;
        out.push_str(line);
    }
    out
}

/// The block's lines with their common indentation removed.
pub(crate) fn dedent(lines: &[String]) -> Vec<String> {
    let indent = lines
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start_matches([' ', '\t']).len())
        .min()
        .unwrap_or(0);
    lines
        .iter()
        .map(|l| {
            if l.trim().is_empty() {
                String::new()
            } else {
                l[indent..].to_string()
            }
        })
        .collect()
}

/// A quoted scalar's value: `"..."` with backslash escapes, `'...'` with
/// `''` for a quote. Whatever follows the closing quote is dropped.
pub(crate) fn unquote(raw: &str) -> String {
    let mut chars = raw.chars();
    let quote = chars.next().unwrap_or('"');
    let mut out = String::new();
    while let Some(c) = chars.next() {
        match (quote, c) {
            ('"', '\\') => match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some(other) => out.push(other),
                None => {}
            },
            ('\'', '\'') => {
                if chars.as_str().starts_with('\'') {
                    chars.next();
                    out.push('\'');
                } else {
                    return out;
                }
            }
            ('"', '"') => return out,
            _ => out.push(c),
        }
    }
    out
}
