//! A document's front matter, found one way everywhere (the frontend's
//! reader takes the same cases: src/utils/frontmatter-cases.json): a first
//! line of `---`, closed by `---` or `...`; a byte-order mark, CRLF line
//! ends and spaces after the fences allowed.

/// The front matter of a text and what follows it.
pub(crate) struct FrontMatter<'a> {
    /// Its lines between the fences, line ends dropped.
    pub lines: Vec<&'a str>,
    /// The text after the closing fence, as written.
    pub body: &'a str,
    /// The line the body starts on (0-based, in the text without its BOM).
    pub body_line: usize,
}

impl FrontMatter<'_> {
    /// Its YAML, the lines joined with `\n`.
    pub fn yaml(&self) -> String {
        self.lines.join("\n")
    }
}

/// `text` without a leading byte-order mark.
pub(crate) fn without_bom(text: &str) -> &str {
    text.strip_prefix('\u{feff}').unwrap_or(text)
}

/// The front matter `text` opens with; None without one, or unclosed.
pub(crate) fn split(text: &str) -> Option<FrontMatter<'_>> {
    let text = without_bom(text);
    let mut lines = text.split_inclusive('\n');
    let bare = |line: &str| line.trim_end_matches(['\n', '\r']).trim_end().to_string();
    let first = lines.next()?;
    if bare(first) != "---" {
        return None;
    }
    let mut offset = first.len();
    let mut header = Vec::new();
    for (i, line) in lines.enumerate() {
        offset += line.len();
        if matches!(bare(line).as_str(), "---" | "...") {
            return Some(FrontMatter {
                lines: header,
                body: &text[offset..],
                body_line: i + 2,
            });
        }
        header.push(line.trim_end_matches(['\n', '\r']));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_as_the_app_does() {
        for (name, text, yaml, body) in crate::ai::workspace::tests::frontmatter_cases() {
            let found = split(&text);
            assert_eq!(found.as_ref().map(FrontMatter::yaml), yaml, "{name}");
            if let Some(found) = found {
                assert_eq!(found.body, body, "{name}");
            }
        }
    }
}

/// The `.md` files in `dir` (files only, no folder named so), in file-name
/// order; none when it can't be read.
pub(crate) fn md_files(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut paths: Vec<_> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("md"))
        .collect();
    paths.sort();
    paths
}
