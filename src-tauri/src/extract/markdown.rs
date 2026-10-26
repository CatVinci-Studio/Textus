//! The Markdown every extractor writes, shared so tables and runs from every
//! format read the same to the model.

/// How a run of text is emphasized.
#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub(super) struct Marks {
    pub bold: bool,
    pub italic: bool,
    pub strike: bool,
}

/// One paragraph's text, assembled run by run. Word splits sentences into many
/// runs, so runs with the same marks and link merge first, or bold would come out
/// as `**He****llo**`.
#[derive(Default)]
pub(super) struct Inline {
    spans: Vec<Span>,
}

struct Span {
    marks: Marks,
    link: Option<String>,
    text: String,
}

impl Inline {
    pub fn push(&mut self, text: &str, marks: Marks, link: Option<&str>) {
        if text.is_empty() {
            return;
        }
        if let Some(last) = self.spans.last_mut() {
            // Whitespace takes on the marks before it: a bold word, a plain
            // space and a bold word are one bold phrase, not two.
            let same = last.marks == marks || text.trim().is_empty();
            if same && last.link.as_deref() == link {
                last.text.push_str(text);
                return;
            }
        }
        self.spans.push(Span {
            marks,
            link: link.map(str::to_string),
            text: text.to_string(),
        });
    }

    /// Text that is already Markdown - an image, a footnote reference.
    pub fn push_markdown(&mut self, markdown: &str) {
        self.push(markdown, Marks::default(), None);
    }

    pub fn render(&self) -> String {
        self.render_with(true)
    }

    /// For a heading, whose emphasis is the heading's: Word styles a heading
    /// bold, and `# **Chapter One**` says nothing `# Chapter One` doesn't.
    pub fn render_plain(&self) -> String {
        self.render_with(false).replace('\n', " ")
    }

    fn render_with(&self, emphasis: bool) -> String {
        let mut out = String::new();
        let mut i = 0;
        while i < self.spans.len() {
            let link = self.spans[i].link.as_deref();
            let mut inner = String::new();
            while i < self.spans.len() && self.spans[i].link.as_deref() == link {
                let span = &self.spans[i];
                let marks = if emphasis {
                    span.marks
                } else {
                    Marks::default()
                };
                inner.push_str(&emphasize(&span.text, marks));
                i += 1;
            }
            match link {
                Some(url) => out.push_str(&linked(&inner, url)),
                None => out.push_str(&inner),
            }
        }
        out.trim().to_string()
    }
}

/// `text` split into leading whitespace, the rest, and trailing whitespace:
/// emphasis must hug the words (`**bold **next` doesn't parse).
pub(super) fn chomp(text: &str) -> (&str, &str, &str) {
    let core = text.trim();
    if core.is_empty() {
        return (text, "", "");
    }
    let start = text.len() - text.trim_start().len();
    let end = start + core.len();
    (&text[..start], core, &text[end..])
}

pub(super) fn emphasize(text: &str, marks: Marks) -> String {
    let (lead, core, trail) = chomp(text);
    if core.is_empty() {
        return text.to_string();
    }
    let mut open = String::new();
    if marks.strike {
        open.push_str("~~");
    }
    if marks.bold {
        open.push_str("**");
    }
    if marks.italic {
        open.push('*');
    }
    let close: String = open.chars().rev().collect();
    format!("{lead}{open}{core}{close}{trail}")
}

/// `[text](url)`, or just the text when there is none to click.
pub(super) fn linked(text: &str, url: &str) -> String {
    let (lead, core, trail) = chomp(text);
    if core.is_empty() || url.is_empty() {
        return text.to_string();
    }
    format!("{lead}[{core}]({}){trail}", link_target(url))
}

/// A URL as a Markdown link target: a space or a parenthesis would end it
/// early, so they are percent-encoded.
pub(super) fn link_target(url: &str) -> String {
    url.trim()
        .replace(' ', "%20")
        .replace('(', "%28")
        .replace(')', "%29")
}

/// Blocks joined the way Markdown reads them: a blank line between
/// paragraphs, none between the items of one list.
#[derive(Default)]
pub(super) struct Blocks {
    out: String,
    /// The level and marker of the list item last written, None after any
    /// other block.
    last_item: Option<(usize, String)>,
}

impl Blocks {
    pub fn push(&mut self, text: &str) {
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        if !self.out.is_empty() {
            self.out.push_str("\n\n");
        }
        self.out.push_str(text);
        self.last_item = None;
    }

    /// A list item at nesting `level` (0 = top), marked `-` or a number (`1.`).
    /// Nested items indent four spaces a level, never more than one deeper than the
    /// item before (deeper is a code block); a switch of marker type starts a new list.
    pub fn push_item(&mut self, level: usize, marker: &str, text: &str) {
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        let (level, same_list) = match &self.last_item {
            Some((previous, last_marker)) => {
                let level = level.min(previous + 1);
                let ordered = |m: &str| m.ends_with('.');
                (
                    level,
                    level != *previous || ordered(last_marker) == ordered(marker),
                )
            }
            None => (0, false),
        };
        if !self.out.is_empty() {
            self.out.push_str(if same_list { "\n" } else { "\n\n" });
        }
        let indent = "    ".repeat(level);
        let hang = " ".repeat(marker.len() + 1);
        for (i, line) in text.lines().enumerate() {
            if i == 0 {
                self.out.push_str(&format!("{indent}{marker} {line}"));
            } else {
                self.out
                    .push_str(&format!("\n{indent}{hang}{}", line.trim_start()));
            }
        }
        self.last_item = Some((level, marker.to_string()));
    }

    pub fn is_empty(&self) -> bool {
        self.out.is_empty()
    }

    pub fn finish(self) -> String {
        self.out
    }
}

/// `text` with every character that would mean Markdown in running text
/// backslash-escaped, so a Word document's `*`, `$5` or `[draft]` stay text.
/// `=`, `&` and `]` only where they'd be markup, matching the editor's writer.
pub(super) fn escape_text(text: &str, in_link: bool) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    for (i, &c) in chars.iter().enumerate() {
        let escape = match c {
            '\\' | '*' | '_' | '`' | '[' | '<' | '~' | '$' => true,
            ']' => in_link,
            '=' => (i > 0 && chars[i - 1] == '=') || chars.get(i + 1) == Some(&'='),
            '&' => starts_entity(&chars[i + 1..]),
            _ => false,
        };
        if escape {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// `amp;`, `#8217;`, `#x2019;`: what after a `&` reads as a character
/// reference.
fn starts_entity(rest: &[char]) -> bool {
    let name = rest
        .iter()
        .take_while(|c| c.is_ascii_alphanumeric() || **c == '#');
    let len = name.count();
    len > 0 && rest.get(len) == Some(&';')
}

/// Escapes what would start a block at the beginning of each line of escaped
/// text (`#`, `>`, list markers, `=`/`-` lines, `|`), since these can interrupt a paragraph.
pub(super) fn escape_line_starts(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 4);
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            out.push('\n');
        }
        let body = line.trim_start();
        let (indent, body) = line.split_at(line.len() - body.len());
        out.push_str(indent);
        if body.starts_with(['#', '>', '-', '+', '=', '|']) {
            out.push('\\');
        } else {
            // "1." and "1)" followed by a space or nothing: an ordered item.
            let digits = body.len() - body.trim_start_matches(|c: char| c.is_ascii_digit()).len();
            let after = &body[digits..];
            if (1..=9).contains(&digits)
                && after.starts_with(['.', ')'])
                && after[1..].chars().next().is_none_or(char::is_whitespace)
            {
                out.push_str(&body[..digits]);
                out.push('\\');
                out.push_str(after);
                continue;
            }
        }
        out.push_str(body);
    }
    out
}

/// A heading's escaped text with a trailing `#` run kept as text, or it would be
/// read as closing hashes and dropped ("Notes #" -> "Notes").
pub(super) fn escape_closing_hashes(text: &str) -> String {
    let body = text.trim_end_matches('#');
    if body.len() == text.len() || !(body.is_empty() || body.ends_with([' ', '\t'])) {
        return text.to_string();
    }
    format!("{body}\\{}", &text[body.len()..])
}

/// A pipe table; the first row is the header. Line breaks in a cell become
/// `<br>`, `|` is escaped, and rows are padded to the widest.
pub(super) fn table(rows: &[Vec<String>]) -> String {
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    if width == 0 {
        return String::new();
    }
    let mut out = String::new();
    for (index, row) in rows.iter().enumerate() {
        let cells: Vec<String> = (0..width)
            .map(|i| row.get(i).map(|cell| table_cell(cell)).unwrap_or_default())
            .collect();
        out.push_str(&format!("| {} |\n", cells.join(" | ")));
        if index == 0 {
            out.push_str(&format!("|{}\n", " --- |".repeat(width)));
        }
    }
    out.truncate(out.trim_end().len());
    out
}

fn table_cell(cell: &str) -> String {
    cell.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("<br>")
        .replace('|', "\\|")
}

#[cfg(test)]
mod tests;
