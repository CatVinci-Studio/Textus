//! RTF to Markdown: paragraphs, emphasis, headings, list items, tables, links
//! and footnotes. Groups inherit their parent's state and restore it on `}`;
//! groups holding no reading text (font table, pictures, `\*`) are skipped.

use super::markdown::{self, Blocks, Inline, Marks};
use std::collections::HashMap;
use std::path::Path;

pub(super) fn rtf_markdown(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"{\\rtf") {
        return Err(crate::errors::error("unreadable"));
    }
    Ok(rtf_to_markdown(&bytes))
}

/// Where a group's text goes.
#[derive(Clone, Copy, PartialEq)]
enum Dest {
    Body,
    Footnote,
    /// A field's instruction (`HYPERLINK "https://…"`), read for its URL.
    FieldInstruction,
    /// The number or bullet Word and TextEdit write before a list item.
    ListText,
    /// The stylesheet, read for which style numbers are headings.
    Stylesheet,
}

/// What `\pard` resets: the properties of the paragraph being written.
#[derive(Clone, Copy, Default)]
struct ParaProps {
    heading: Option<usize>,
    list_level: usize,
    /// `\intbl`: the paragraph is (in) a table cell.
    in_table: bool,
    /// `\sN`: the paragraph's style - or, inside the stylesheet, the style
    /// an entry defines.
    style: Option<i32>,
}

#[derive(Clone)]
struct Group {
    marks: Marks,
    skip: bool,
    /// Characters standing in for each `\u` - skipped, as an RTF reader
    /// that understands `\u` must.
    uc: usize,
    dest: Dest,
    link: Option<String>,
    para: ParaProps,
}

/// Groups whose text is not the document's.
const SKIPPED: &[&str] = &[
    "fonttbl",
    "colortbl",
    "info",
    "pict",
    "object",
    "header",
    "headerl",
    "headerr",
    "headerf",
    "footer",
    "footerl",
    "footerr",
    "footerf",
    "listtable",
    "listoverridetable",
    "rsidtbl",
    "xmlnstbl",
    "generator",
    "themedata",
    "colorschememapping",
    "latentstyles",
    "datastore",
    "filetbl",
    "revtbl",
    "expandedcolortbl",
    "pgdsctbl",
    "shppict",
    "nonshppict",
    "mmathPr",
    "bkmkstart",
    "bkmkend",
    "author",
    "operator",
];

struct Rtf {
    stack: Vec<Group>,
    encoding: &'static encoding_rs::Encoding,
    /// `\'hh` bytes not yet decoded: a two-byte character (GBK, Shift-JIS)
    /// arrives as two escapes, so they are decoded together.
    bytes: Vec<u8>,
    /// Characters still to skip after a `\u`.
    skip_chars: usize,
    /// A UTF-16 high surrogate waiting for its pair.
    high_surrogate: Option<u16>,
    out: Blocks,
    paragraph: Inline,
    list_text: String,
    /// Style number -> lowercase name ("heading 1").
    styles: HashMap<i32, String>,
    style_name: String,
    /// The table being read: its rows, the current row's cells, and the
    /// paragraphs of the current cell.
    table: Vec<Vec<String>>,
    row: Vec<String>,
    cell: String,
    notes: Vec<Inline>,
    instruction: String,
    field_link: Option<String>,
}

pub(super) fn rtf_to_markdown(input: &[u8]) -> String {
    let mut rtf = Rtf {
        stack: vec![Group {
            marks: Marks::default(),
            skip: false,
            uc: 1,
            dest: Dest::Body,
            link: None,
            para: ParaProps::default(),
        }],
        encoding: encoding_rs::WINDOWS_1252,
        bytes: Vec::new(),
        skip_chars: 0,
        high_surrogate: None,
        out: Blocks::default(),
        paragraph: Inline::default(),
        list_text: String::new(),
        styles: HashMap::new(),
        style_name: String::new(),
        table: Vec::new(),
        row: Vec::new(),
        cell: String::new(),
        notes: Vec::new(),
        instruction: String::new(),
        field_link: None,
    };
    rtf.run(input);
    rtf.end_paragraph();
    rtf.end_table();
    let mut text = rtf.out.finish();
    for (i, note) in rtf.notes.iter().enumerate() {
        text.push_str(&format!("\n\n[^{}]: {}", i + 1, note.render()));
    }
    text.trim().to_string()
}

impl Rtf {
    fn group(&mut self) -> &mut Group {
        // The root group is never popped (see `}` below).
        self.stack.last_mut().expect("root group")
    }

    fn run(&mut self, input: &[u8]) {
        let mut i = 0;
        while i < input.len() {
            let byte = input[i];
            match byte {
                b'{' => {
                    self.flush_bytes();
                    let top = self.group().clone();
                    self.stack.push(top);
                    i += 1;
                }
                b'}' => {
                    self.flush_bytes();
                    if self.stack.len() > 1 {
                        let closed = self.stack.pop().expect("checked");
                        self.close(&closed);
                    }
                    i += 1;
                }
                b'\\' => i = self.control(input, i + 1),
                b'\r' | b'\n' => i += 1,
                _ => {
                    if self.take_skipped_char() {
                        i += 1;
                        continue;
                    }
                    if byte >= 0x80 {
                        self.bytes.push(byte);
                    } else {
                        self.flush_bytes();
                        self.emit(&(byte as char).to_string());
                    }
                    i += 1;
                }
            }
        }
        self.flush_bytes();
    }

    /// A control word or symbol starting at `i` (just past the backslash);
    /// returns where the next token starts.
    fn control(&mut self, input: &[u8], mut i: usize) -> usize {
        let Some(&first) = input.get(i) else {
            return i;
        };
        if first == b'\'' {
            let hex = input
                .get(i + 1..i + 3)
                .and_then(|h| std::str::from_utf8(h).ok());
            if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                if !self.take_skipped_char() {
                    self.bytes.push(byte);
                }
            }
            return i + 3;
        }
        self.flush_bytes();
        if !first.is_ascii_alphabetic() {
            if self.take_skipped_char() {
                return i + 1;
            }
            match first {
                b'\\' | b'{' | b'}' => self.emit(&(first as char).to_string()),
                b'~' => self.emit("\u{a0}"),
                b'_' => self.emit("\u{2011}"),
                b'*' => self.group().skip = true,
                b'\n' | b'\r' => self.end_paragraph(),
                _ => {}
            }
            return i + 1;
        }

        let start = i;
        while input.get(i).is_some_and(u8::is_ascii_alphabetic) {
            i += 1;
        }
        let word = std::str::from_utf8(&input[start..i]).unwrap_or_default();
        let number_start = i;
        if input.get(i) == Some(&b'-') {
            i += 1;
        }
        while input.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
        }
        let param: Option<i32> = std::str::from_utf8(&input[number_start..i])
            .ok()
            .and_then(|n| n.parse().ok());
        if input.get(i) == Some(&b' ') {
            i += 1;
        }
        if word == "bin" {
            // Raw binary data of `param` bytes: not text, and it may contain
            // braces that would derail the groups.
            return i + param.unwrap_or(0).max(0) as usize;
        }
        self.word(word, param);
        i
    }

    fn word(&mut self, word: &str, param: Option<i32>) {
        let on = param != Some(0);
        match word {
            "par" | "sect" | "page" => self.end_paragraph(),
            "line" => self.emit("\n"),
            "tab" => self.emit("\t"),
            "cell" => self.end_cell(),
            "row" => self.end_row(),
            "pard" => self.group().para = ParaProps::default(),
            "intbl" => self.group().para.in_table = true,
            "s" => self.group().para.style = param,
            "plain" => self.group().marks = Marks::default(),
            "b" => self.group().marks.bold = on,
            "i" => self.group().marks.italic = on,
            "strike" | "striked" => self.group().marks.strike = on,
            "outlinelevel" => {
                let level = param.and_then(|l| usize::try_from(l).ok());
                self.group().para.heading = level.filter(|l| *l < 6).map(|l| l + 1);
            }
            "ilvl" => {
                self.group().para.list_level =
                    param.and_then(|l| usize::try_from(l).ok()).unwrap_or(0)
            }
            "uc" => self.group().uc = param.and_then(|n| usize::try_from(n).ok()).unwrap_or(1),
            "u" => {
                if let Some(code) = param {
                    // \u is a signed 16-bit number: \u-3913 is U+F0B7.
                    self.unicode(code.rem_euclid(65536) as u16);
                }
                self.skip_chars = self.group().uc;
            }
            "ansicpg" => {
                if let Some(encoding) = param
                    .and_then(|cp| u16::try_from(cp).ok())
                    .and_then(codepage::to_encoding)
                {
                    self.encoding = encoding;
                }
            }
            "mac" => self.encoding = encoding_rs::MACINTOSH,
            "emdash" => self.emit("\u{2014}"),
            "endash" => self.emit("\u{2013}"),
            "bullet" => self.emit("\u{2022}"),
            "lquote" => self.emit("\u{2018}"),
            "rquote" => self.emit("\u{2019}"),
            "ldblquote" => self.emit("\u{201c}"),
            "rdblquote" => self.emit("\u{201d}"),
            "emspace" | "enspace" | "qmspace" => self.emit(" "),
            "footnote" => {
                // Straight into the paragraph: the group is usually `{\*\footnote`,
                // skipped until this word claims it.
                let number = self.notes.len() + 1;
                self.paragraph.push_markdown(&format!("[^{number}]"));
                self.notes.push(Inline::default());
                let group = self.group();
                group.dest = Dest::Footnote;
                group.skip = false;
            }
            "field" => {
                self.instruction.clear();
                self.field_link = None;
            }
            "fldinst" => {
                let group = self.group();
                group.dest = Dest::FieldInstruction;
                group.skip = false;
            }
            "fldrslt" => {
                let link = self.field_link.take();
                let group = self.group();
                group.skip = false;
                group.link = link;
            }
            "stylesheet" => {
                let group = self.group();
                group.dest = Dest::Stylesheet;
                group.skip = false;
            }
            "listtext" | "pntext" => {
                self.list_text.clear();
                let group = self.group();
                group.dest = Dest::ListText;
                group.skip = false;
            }
            word if SKIPPED.contains(&word) => self.group().skip = true,
            _ => {}
        }
    }

    fn close(&mut self, closed: &Group) {
        let parent = self.group().dest;
        if closed.dest == Dest::FieldInstruction && parent != Dest::FieldInstruction {
            self.field_link = hyperlink(&self.instruction);
        }
        // `{\s1 ... heading 1;}`, one entry of the stylesheet.
        if closed.dest == Dest::Stylesheet && parent == Dest::Stylesheet {
            let name = std::mem::take(&mut self.style_name);
            if let Some(style) = closed.para.style {
                let name = name.trim().trim_end_matches(';').trim().to_lowercase();
                self.styles.insert(style, name);
            }
        }
    }

    fn take_skipped_char(&mut self) -> bool {
        if self.skip_chars > 0 {
            self.skip_chars -= 1;
            return true;
        }
        false
    }

    fn unicode(&mut self, unit: u16) {
        if (0xD800..0xDC00).contains(&unit) {
            self.high_surrogate = Some(unit);
            return;
        }
        let text = match self.high_surrogate.take() {
            Some(high) => String::from_utf16_lossy(&[high, unit]),
            None => String::from_utf16_lossy(&[unit]),
        };
        self.emit(&text);
    }
}

mod emit;
use emit::hyperlink;

#[cfg(test)]
mod tests;
