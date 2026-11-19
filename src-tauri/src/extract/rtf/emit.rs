//! What the reader writes out: text in its group's marks, paragraphs as
//! their style says (headings, list items, quotes), and tables row by row.

use super::markdown;
use super::{Dest, Rtf};

impl Rtf {
    pub(super) fn flush_bytes(&mut self) {
        if self.bytes.is_empty() {
            return;
        }
        let bytes = std::mem::take(&mut self.bytes);
        let (text, _) = self.encoding.decode_without_bom_handling(&bytes);
        self.emit(&text);
    }

    pub(super) fn emit(&mut self, text: &str) {
        let group = self.stack.last().expect("root group");
        if group.skip {
            return;
        }
        match group.dest {
            Dest::Body => self
                .paragraph
                .push(text, group.marks, group.link.as_deref()),
            Dest::Footnote => {
                if let Some(note) = self.notes.last_mut() {
                    note.push(text, group.marks, group.link.as_deref());
                }
            }
            Dest::FieldInstruction => self.instruction.push_str(text),
            Dest::ListText => self.list_text.push_str(text),
            Dest::Stylesheet => self.style_name.push_str(text),
        }
    }

    pub(super) fn end_paragraph(&mut self) {
        let group = self.stack.last().expect("root group");
        let (dest, para) = (group.dest, group.para);
        if dest == Dest::Footnote {
            self.emit(" ");
            return;
        }
        let line = std::mem::take(&mut self.paragraph);
        let marker = std::mem::take(&mut self.list_text);
        if para.in_table {
            self.cell.push_str(&line.render());
            self.cell.push('\n');
            return;
        }
        self.end_table();
        let heading = para.heading.or_else(|| {
            let name = self.styles.get(&para.style?)?;
            heading_of_style(name)
        });
        let marker = marker.trim();
        if let Some(level) = heading.filter(|_| !line.render_plain().is_empty()) {
            self.out
                .push(&format!("{} {}", "#".repeat(level), line.render_plain()));
        } else if !marker.is_empty() {
            self.out.push_item(
                para.list_level,
                &markdown::list_mark(marker),
                &line.render(),
            );
        } else {
            self.out.push(&line.render());
        }
    }

    pub(super) fn end_cell(&mut self) {
        let mut cell = std::mem::take(&mut self.cell);
        cell.push_str(&std::mem::take(&mut self.paragraph).render());
        self.row.push(cell.trim().to_string());
    }

    pub(super) fn end_row(&mut self) {
        let row = std::mem::take(&mut self.row);
        if !row.is_empty() {
            self.table.push(row);
        }
    }

    pub(super) fn end_table(&mut self) {
        self.end_row();
        if !self.table.is_empty() {
            let table = std::mem::take(&mut self.table);
            self.out.push(&markdown::table(&table));
        }
    }
}

/// "heading 2" -> 2, as Word and LibreOffice name their heading styles.
fn heading_of_style(name: &str) -> Option<usize> {
    if name == "title" {
        return Some(1);
    }
    let level: usize = name.strip_prefix("heading ")?.trim().parse().ok()?;
    (1..=6).contains(&level).then_some(level)
}

/// The URL of a `HYPERLINK "https://…"` field instruction.
pub(super) fn hyperlink(instruction: &str) -> Option<String> {
    let rest = instruction.trim().strip_prefix("HYPERLINK")?.trim();
    // `HYPERLINK \l "_Toc1"`: a place in the document itself, no URL.
    if rest.starts_with('\\') {
        return None;
    }
    let url = rest.trim_start_matches('"');
    let url = url.split('"').next()?.trim();
    (!url.is_empty()).then(|| url.to_string())
}
