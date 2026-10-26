//! Word (.docx) to Markdown: headings, lists, tables, emphasis, links, images
//! by alt text, and notes as `[^1]` references. Follows mammoth's default style
//! map, as MarkItDown (MIT) does, but reads the parts directly.

use super::markdown::{self, Blocks, Inline, Marks};
use super::xml::{resolve_part, zip_entry, Node, Pull, Rels, Tag};
use std::collections::HashMap;
use std::path::Path;

mod styles;
pub(crate) use styles::*;
mod numbering;
pub(crate) use numbering::*;

/// Saves one picture of a document being opened (its file name in the .docx
/// and its bytes) and returns the src to link it by.
pub(crate) type SaveImage<'a> = dyn FnMut(&str, &[u8]) -> Option<String> + 'a;

/// The src a picture's relationship target is saved as (`convert`).
type Picture<'a> = dyn FnMut(&str) -> Option<String> + 'a;

/// The Markdown the AI reads: the text as written, pictures by their path
/// inside the file.
pub(super) fn docx_markdown(path: &Path) -> Result<String, String> {
    convert(path, None)
}

/// The Markdown of a Word file opened as a document. Unlike the AI's, the text
/// is escaped, line breaks stay breaks, and each picture goes to `save_image`,
/// whose src the document links to (None: linked by its path inside the file).
pub(crate) fn docx_document(path: &Path, save_image: &mut SaveImage<'_>) -> Result<String, String> {
    convert(path, Some(save_image))
}

fn convert(path: &Path, save_image: Option<&mut SaveImage<'_>>) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|_| "This .docx is not a readable Word file.".to_string())?;
    let body = zip_entry(&mut zip, "word/document.xml")
        .ok_or_else(|| "This .docx has no document body.".to_string())?;
    let part = |zip: &mut zip::ZipArchive<_>, name: &str| zip_entry(zip, name).unwrap_or_default();
    let styles = Styles::parse(&part(&mut zip, "word/styles.xml"));
    let numbering = Numbering::parse(&part(&mut zip, "word/numbering.xml"));
    let notes: Vec<_> = ["footnote", "endnote"]
        .into_iter()
        .map(|kind| {
            let xml = part(&mut zip, &format!("word/{kind}s.xml"));
            let rels = Rels::parse(&part(&mut zip, &format!("word/_rels/{kind}s.xml.rels")));
            (kind, xml, rels)
        })
        .collect();
    let rels = Rels::parse(&part(&mut zip, "word/_rels/document.xml.rels"));

    // The pictures are read out of the file as the text reaches them; one
    // used twice is saved once.
    let mut saved: HashMap<String, Option<String>> = HashMap::new();
    let mut picture = save_image.map(|save| {
        move |target: &str| -> Option<String> {
            if let Some(src) = saved.get(target) {
                return src.clone();
            }
            let entry = resolve_part("word", target);
            let name = entry.rsplit('/').next().unwrap_or_default().to_string();
            let src = zip_entry(&mut zip, &entry).and_then(|bytes| save(&name, &bytes));
            saved.insert(target.to_string(), src.clone());
            src
        }
    });

    let mut doc = Docx {
        styles,
        numbering,
        rels: Rels::default(),
        notes: HashMap::new(),
        cited: Vec::new(),
        picture: picture.as_mut().map(|f| f as &mut Picture<'_>),
        one_line: 0,
    };
    // Notes first, so a reference in the body can number itself.
    for (kind, xml, rels) in notes {
        doc.rels = rels;
        doc.read_notes(&xml, kind);
    }
    doc.rels = rels;

    let mut out = Blocks::default();
    doc.blocks(&mut Pull::new(&body), &mut out);
    let mut text = out.finish();
    // Definitions after the body, as a Markdown reader expects them.
    for (number, (kind, id)) in doc.cited.iter().enumerate() {
        if let Some(note) = doc.notes.get(&(*kind, id.clone())) {
            text.push_str(&format!("\n\n[^{}]: {note}", number + 1));
        }
    }
    Ok(text.trim().to_string())
}

struct Docx<'a> {
    styles: Styles,
    numbering: Numbering,
    rels: Rels,
    /// Footnote and endnote text by ("footnote" | "endnote", w:id).
    notes: HashMap<(&'static str, String), String>,
    /// The notes in the order the body refers to them; a note's number is
    /// its place here.
    cited: Vec<(&'static str, String)>,
    /// Set when the file is opened as a document: the src a picture's
    /// relationship target is saved as. It also means the text is escaped.
    picture: Option<&'a mut Picture<'a>>,
    /// Inside a table cell or a note, whose paragraphs are written on one
    /// line: a line break there is no Markdown break.
    one_line: usize,
}

/// What `<w:pPr>` says about a paragraph.
#[derive(Default)]
struct ParaProps {
    style: Option<String>,
    outline: Option<usize>,
    /// (ilvl, numId)
    numbering: Option<(usize, String)>,
}

impl Docx<'_> {
    /// Opened as a document rather than read for the AI.
    fn opening(&self) -> bool {
        self.picture.is_some()
    }

    /// A run's text as Markdown text, `in_link` when it is a link's.
    fn text(&self, text: &str, in_link: bool) -> String {
        if self.opening() {
            markdown::escape_text(text, in_link)
        } else {
            text.to_string()
        }
    }

    /// A paragraph's rendered runs as the lines of one block. Opened as a document,
    /// a line break is a hard break, and no line may start a block of its own.
    fn lines(&self, text: String) -> String {
        if !self.opening() {
            return text;
        }
        let text = markdown::escape_line_starts(&text);
        if self.one_line > 0 {
            text
        } else {
            text.replace('\n', "\\\n")
        }
    }

    /// Paragraphs and tables until the Close of the element they sit in. Content
    /// controls, custom XML and inserted revisions are looked through.
    fn blocks(&mut self, x: &mut Pull, out: &mut Blocks) {
        let mut depth = 0usize;
        loop {
            match x.next() {
                Node::Open(tag) => match tag.name.as_str() {
                    "p" => self.paragraph(x, out),
                    "tbl" => out.push(&self.table(x)),
                    // mc:AlternateContent carries a drawing twice, the
                    // Fallback for old readers; reading both doubles it.
                    "Fallback" | "sectPr" | "del" => x.skip(),
                    _ => depth += 1,
                },
                Node::Close if depth == 0 => return,
                Node::Close => depth -= 1,
                Node::Text(_) => {}
                Node::End => return,
            }
        }
    }

    fn paragraph(&mut self, x: &mut Pull, out: &mut Blocks) {
        let mut props = ParaProps::default();
        let mut line = Inline::default();
        // Text boxes anchored in this paragraph: paragraphs of their own,
        // written after it.
        let mut boxed = Blocks::default();
        loop {
            match x.next() {
                Node::Open(tag) if tag.name == "pPr" => props = paragraph_props(x),
                Node::Open(tag) => self.inline(x, &tag, None, &mut line, &mut boxed),
                Node::Close | Node::End => break,
                Node::Text(_) => {}
            }
        }

        let style = props.style.as_deref();
        let heading = props
            .outline
            .or_else(|| style.and_then(|s| self.styles.heading(s)));
        let numbering = props
            .numbering
            .or_else(|| style.and_then(|s| self.styles.numbering(s)))
            .filter(|(_, id)| id != "0");
        if let Some(level) = heading.filter(|_| !line.render_plain().is_empty()) {
            let mut text = line.render_plain();
            if self.opening() {
                text = markdown::escape_closing_hashes(&text);
            }
            out.push(&format!("{} {text}", "#".repeat(level.min(6))));
        } else if let Some((level, id)) = numbering {
            let text = self.lines(line.render());
            let marker = if self.numbering.is_bullet(&id, level) {
                "-".to_string()
            } else {
                format!("{}.", self.numbering.next_number(&id, level))
            };
            out.push_item(level, &marker, &text);
        } else if style.is_some_and(|s| self.styles.is_quote(s)) {
            let text = self.lines(line.render());
            let quoted: Vec<String> = text.lines().map(|l| format!("> {l}")).collect();
            out.push(&quoted.join("\n"));
        } else {
            out.push(&self.lines(line.render()));
        }
        if !boxed.is_empty() {
            out.push(&boxed.finish());
        }
    }

    /// One element inside a paragraph, whose Open was just read.
    fn inline(
        &mut self,
        x: &mut Pull,
        tag: &Tag,
        link: Option<&str>,
        line: &mut Inline,
        boxed: &mut Blocks,
    ) {
        match tag.name.as_str() {
            "r" => self.run(x, link, line, boxed),
            "hyperlink" => {
                let url = tag
                    .attr("id")
                    .and_then(|id| self.rels.link(id))
                    .map(str::to_string);
                self.inline_children(x, url.as_deref().or(link), line, boxed);
            }
            "Fallback" | "del" | "moveFrom" => x.skip(),
            // fldSimple, smartTag, ins, sdt...: their runs are the text.
            _ => self.inline_children(x, link, line, boxed),
        }
    }

    fn inline_children(
        &mut self,
        x: &mut Pull,
        link: Option<&str>,
        line: &mut Inline,
        boxed: &mut Blocks,
    ) {
        loop {
            match x.next() {
                Node::Open(tag) => self.inline(x, &tag, link, line, boxed),
                Node::Close | Node::End => return,
                Node::Text(_) => {}
            }
        }
    }

    fn run(&mut self, x: &mut Pull, link: Option<&str>, line: &mut Inline, boxed: &mut Blocks) {
        let mut marks = Marks::default();
        loop {
            let tag = match x.next() {
                Node::Open(tag) => tag,
                Node::Close | Node::End => return,
                Node::Text(_) => continue,
            };
            match tag.name.as_str() {
                "rPr" => marks = self.run_props(x),
                "t" => {
                    let text = self.text(&x.text(), link.is_some());
                    line.push(&text, marks, link);
                }
                "tab" => {
                    x.skip();
                    line.push("\t", marks, link);
                }
                // A page break ends nothing a reader of the text sees.
                "br" | "cr" => {
                    x.skip();
                    if tag.attr("type") != Some("page") {
                        line.push("\n", marks, link);
                    }
                }
                "footnoteReference" | "endnoteReference" => {
                    x.skip();
                    let kind = if tag.name == "footnoteReference" {
                        "footnote"
                    } else {
                        "endnote"
                    };
                    if let Some(id) = tag.attr("id") {
                        line.push_markdown(&format!("[^{}]", self.cite(kind, id)));
                    }
                }
                "drawing" | "pict" | "AlternateContent" | "Choice" => {
                    if let Some(image) = self.drawing(x, boxed) {
                        line.push_markdown(&image);
                    }
                }
                _ => x.skip(),
            }
        }
    }

    fn run_props(&self, x: &mut Pull) -> Marks {
        let mut marks = Marks::default();
        loop {
            match x.next() {
                Node::Open(tag) => {
                    match tag.name.as_str() {
                        "b" => marks.bold = tag.is_on(),
                        "i" => marks.italic = tag.is_on(),
                        "strike" | "dstrike" => marks.strike = tag.is_on(),
                        // The built-in character styles a writer applies
                        // instead of the B and I buttons.
                        "rStyle" => match tag.attr("val").map(|s| self.styles.name(s)) {
                            Some("strong") => marks.bold = true,
                            Some("emphasis") => marks.italic = true,
                            _ => {}
                        },
                        _ => {}
                    }
                    x.skip();
                }
                Node::Close | Node::End => return marks,
                Node::Text(_) => {}
            }
        }
    }

    /// A picture as `![alt text](media/image1.png)`; text boxes in it go to `boxed`.
    fn drawing(&mut self, x: &mut Pull, boxed: &mut Blocks) -> Option<String> {
        let mut alt = String::new();
        let mut target = None;
        let mut depth = 0usize;
        loop {
            match x.next() {
                Node::Open(tag) => match tag.name.as_str() {
                    "docPr" | "cNvPr" => {
                        let text = tag.attr("descr").or(tag.attr("title")).unwrap_or_default();
                        if alt.is_empty() {
                            alt = image_alt(text);
                        }
                        x.skip();
                    }
                    "blip" | "imagedata" => {
                        let id = tag.attr("embed").or(tag.attr("id"));
                        if let Some(found) = id.and_then(|id| self.rels.target(id)) {
                            target.get_or_insert_with(|| found.to_string());
                        }
                        x.skip();
                    }
                    "txbxContent" => self.blocks(x, boxed),
                    "Fallback" => x.skip(),
                    _ => depth += 1,
                },
                Node::Close if depth == 0 => break,
                Node::Close => depth -= 1,
                Node::Text(_) => {}
                Node::End => break,
            }
        }
        let mut target = target?;
        // An external picture (TargetMode="External") is a URL already.
        if !target.contains("://") {
            if let Some(src) = self.picture.as_mut().and_then(|save| save(&target)) {
                target = src;
            }
        }
        Some(format!("![{alt}]({})", markdown::link_target(&target)))
    }

    fn table(&mut self, x: &mut Pull) -> String {
        let mut rows = Vec::new();
        let mut depth = 0usize;
        loop {
            match x.next() {
                Node::Open(tag) => match tag.name.as_str() {
                    "tr" => rows.push(self.row(x)),
                    "tblPr" | "tblGrid" => x.skip(),
                    _ => depth += 1,
                },
                Node::Close if depth == 0 => break,
                Node::Close => depth -= 1,
                Node::Text(_) => {}
                Node::End => break,
            }
        }
        markdown::table(&rows)
    }

    fn row(&mut self, x: &mut Pull) -> Vec<String> {
        let mut cells = Vec::new();
        let mut depth = 0usize;
        loop {
            match x.next() {
                Node::Open(tag) => match tag.name.as_str() {
                    "tc" => {
                        let (text, span) = self.cell(x);
                        cells.push(text);
                        // A merged cell keeps the columns after it in place.
                        cells.extend(std::iter::repeat_n(String::new(), span - 1));
                    }
                    "trPr" | "tblPrEx" => x.skip(),
                    _ => depth += 1,
                },
                Node::Close if depth == 0 => break,
                Node::Close => depth -= 1,
                Node::Text(_) => {}
                Node::End => break,
            }
        }
        cells
    }

    /// A cell's text and how many grid columns it spans.
    fn cell(&mut self, x: &mut Pull) -> (String, usize) {
        let mut span = 1;
        let mut content = Blocks::default();
        self.one_line += 1;
        loop {
            match x.next() {
                Node::Open(tag) => match tag.name.as_str() {
                    "tcPr" => span = cell_span(x),
                    "p" => self.paragraph(x, &mut content),
                    "tbl" => content.push(&self.table(x)),
                    _ => x.skip(),
                },
                Node::Close | Node::End => break,
                Node::Text(_) => {}
            }
        }
        self.one_line -= 1;
        (content.finish(), span)
    }

    fn read_notes(&mut self, xml: &[u8], kind: &'static str) {
        let mut x = Pull::new(xml);
        loop {
            match x.next() {
                Node::Open(tag) if tag.name == kind => {
                    let id = tag.attr("id").unwrap_or_default().to_string();
                    let mut content = Blocks::default();
                    self.one_line += 1;
                    self.blocks(&mut x, &mut content);
                    self.one_line -= 1;
                    // A definition is one paragraph; the separator "notes"
                    // Word keeps beside the real ones are empty.
                    let text = content
                        .finish()
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" ");
                    if !text.is_empty() {
                        self.notes.insert((kind, id), text);
                    }
                }
                Node::End => return,
                _ => {}
            }
        }
    }

    /// The number of the note `id`, numbering it on first reference.
    fn cite(&mut self, kind: &'static str, id: &str) -> usize {
        let key = (kind, id.to_string());
        if let Some(i) = self.cited.iter().position(|cited| *cited == key) {
            return i + 1;
        }
        self.cited.push(key);
        self.cited.len()
    }
}

fn paragraph_props(x: &mut Pull) -> ParaProps {
    let mut props = ParaProps::default();
    let mut ilvl = 0;
    let mut num_id = None;
    let mut depth = 0usize;
    loop {
        match x.next() {
            Node::Open(tag) => {
                match tag.name.as_str() {
                    "pStyle" => props.style = tag.attr("val").map(str::to_string),
                    "outlineLvl" => props.outline = heading_of_outline(&tag),
                    "ilvl" => ilvl = tag.attr("val").and_then(|v| v.parse().ok()).unwrap_or(0),
                    "numId" => num_id = tag.attr("val").map(str::to_string),
                    // The paragraph mark's own formatting and revisions.
                    "rPr" | "pPrChange" => {
                        x.skip();
                        continue;
                    }
                    _ => {}
                }
                depth += 1;
            }
            Node::Close if depth == 0 => break,
            Node::Close => depth -= 1,
            Node::Text(_) => {}
            Node::End => break,
        }
    }
    props.numbering = num_id.map(|id| (ilvl, id));
    props
}

/// `<w:outlineLvl w:val="0"/>` is a top heading; 9 is body text.
fn heading_of_outline(tag: &Tag) -> Option<usize> {
    let level: usize = tag.attr("val")?.parse().ok()?;
    (level < 6).then_some(level + 1)
}

fn cell_span(x: &mut Pull) -> usize {
    let mut span = 1;
    let mut depth = 0usize;
    loop {
        match x.next() {
            Node::Open(tag) => {
                if tag.name == "gridSpan" {
                    span = tag
                        .attr("val")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(1)
                        .clamp(1, 64);
                }
                depth += 1;
            }
            Node::Close if depth == 0 => return span,
            Node::Close => depth -= 1,
            Node::Text(_) => {}
            Node::End => return span,
        }
    }
}

/// Alt text on one line, without the brackets that would end it early.
pub(super) fn image_alt(text: &str) -> String {
    text.replace(['[', ']'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// A .docx holding `body` (the inside of `<w:body>`) plus optional parts
/// `(zip path, xml)`, for tests that need a real Word file on disk.
#[cfg(test)]
pub(crate) fn test_docx_with(body: &str, parts: &[(&str, &str)]) -> Vec<u8> {
    use std::io::Write;
    const W: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;
    let xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>{body}</w:body></w:document>"#
    );
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    zip.start_file("word/document.xml", options).unwrap();
    zip.write_all(xml.as_bytes()).unwrap();
    for (name, content) in parts {
        zip.start_file(*name, options).unwrap();
        zip.write_all(content.replace("{W}", W).as_bytes()).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

#[cfg(test)]
mod tests;
