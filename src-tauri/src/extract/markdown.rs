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

/// `[text](url)`, or just the text when there is none to click - or none
/// safe to (`javascript:`, `data:`).
pub(super) fn linked(text: &str, url: &str) -> String {
    let (lead, core, trail) = chomp(text);
    if core.is_empty() || !super::html::followable(url) {
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

/// A list item's Markdown mark from the marker a word processor wrote:
/// `3.`, `(3)`, `3、`, `1.3.`, `c)`, `iii.` and `三、` are item 3, anything
/// else (a bullet character, a word) a bullet.
pub(super) fn list_mark(marker: &str) -> String {
    let marker = marker.trim();
    let stem = marker
        .trim_start_matches(['(', '（'])
        .trim_end_matches(['.', ')', '）', '、']);
    let punctuated = stem.len() < marker.len();
    match item_number(stem).filter(|_| punctuated) {
        Some(n) => format!("{n}."),
        None => "-".to_string(),
    }
}

/// What a list marker's stem counts to: digits (the last of `1.3`), a
/// Roman numeral, a letter or a run of one (Word's `aa` after `z`), or a
/// Chinese numeral below a hundred.
fn item_number(stem: &str) -> Option<u32> {
    let last = stem.rsplit('.').next()?;
    if stem.split('.').all(|part| part.parse::<u32>().is_ok()) {
        return last.parse().ok();
    }
    if let Some(n) = chinese(stem) {
        return Some(n);
    }
    // i, ii, iv, xi… are Roman far more often than letters past h.
    if stem.chars().all(|c| "ivxIVX".contains(c)) {
        return roman(stem);
    }
    let first = stem.chars().next()?;
    if first.is_ascii_alphabetic() && stem.chars().all(|c| c == first) {
        let place = first.to_ascii_lowercase() as u32 - 'a' as u32 + 1;
        return Some((stem.len() as u32 - 1) * 26 + place);
    }
    roman(stem)
}

/// 三 is 3, 十一 is 11, 二十 is 20, 九十九 is 99.
fn chinese(stem: &str) -> Option<u32> {
    let digit = |c: char| {
        "一二三四五六七八九"
            .chars()
            .position(|d| d == c)
            .map(|n| n as u32 + 1)
    };
    let chars: Vec<char> = stem.chars().collect();
    match chars[..] {
        ['十'] => Some(10),
        [d] => digit(d),
        ['十', one] => Some(10 + digit(one)?),
        [tens, '十'] => Some(10 * digit(tens)?),
        [tens, '十', one] => Some(10 * digit(tens)? + digit(one)?),
        _ => None,
    }
}

/// A Roman numeral as a word processor writes it, in either case. `iiii`,
/// `vx` and `ic` add up to 4, 5 and 99 but aren't numerals, so they count
/// as nothing, as `十十` does.
fn roman(stem: &str) -> Option<u32> {
    let value = |c: char| match c.to_ascii_lowercase() {
        'i' => Some(1),
        'v' => Some(5),
        'x' => Some(10),
        'l' => Some(50),
        'c' => Some(100),
        'd' => Some(500),
        'm' => Some(1000),
        _ => None,
    };
    let digits: Vec<u32> = stem.chars().map(value).collect::<Option<_>>()?;
    let total = digits.iter().enumerate().fold(0i64, |sum, (k, &d)| {
        if digits.get(k + 1).is_some_and(|&next| next > d) {
            sum - d as i64
        } else {
            sum + d as i64
        }
    });
    let n = u32::try_from(total).ok().filter(|&n| n > 0)?;
    to_roman(n).eq_ignore_ascii_case(stem).then_some(n)
}

/// 4 is `iv`, 14 `xiv`, 40 `xl`.
fn to_roman(mut n: u32) -> String {
    const NUMERALS: [(u32, &str); 13] = [
        (1000, "m"),
        (900, "cm"),
        (500, "d"),
        (400, "cd"),
        (100, "c"),
        (90, "xc"),
        (50, "l"),
        (40, "xl"),
        (10, "x"),
        (9, "ix"),
        (5, "v"),
        (4, "iv"),
        (1, "i"),
    ];
    let mut out = String::new();
    for (value, numeral) in NUMERALS {
        while n >= value {
            out.push_str(numeral);
            n -= value;
        }
    }
    out
}

#[cfg(test)]
mod tests;
