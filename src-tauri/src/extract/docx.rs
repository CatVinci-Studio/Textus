//! Word (.docx) to Markdown: headings from the paragraph styles, numbered and
//! bulleted lists from the numbering part, tables, bold, italic and
//! strikethrough, links, images by their alt text, and footnotes and
//! endnotes as `[^1]` references with their text at the end.
//!
//! MarkItDown (github.com/microsoft/markitdown, MIT) gets here through
//! mammoth's docx-to-HTML and then HTML to Markdown; without Python, this
//! reads the same parts of the file directly. What it keeps follows
//! mammoth's default style map: built-in "heading N" styles (and styles based
//! on them) become headings, "Title" a top heading.

use super::markdown::{self, Blocks, Inline, Marks};
use super::xml::{resolve_part, zip_entry, Node, Pull, Rels, Tag};
use std::collections::HashMap;
use std::path::Path;

/// Saves one picture of a document being opened - its file name in the
/// .docx and its bytes - and returns the src to link it by.
pub(crate) type SaveImage<'a> = dyn FnMut(&str, &[u8]) -> Option<String> + 'a;

/// The src a picture's relationship target is saved as (`convert`).
type Picture<'a> = dyn FnMut(&str) -> Option<String> + 'a;

/// The Markdown the AI reads: the text as written, pictures by their path
/// inside the file.
pub(super) fn docx_markdown(path: &Path) -> Result<String, String> {
    convert(path, None)
}

/// The Markdown of a Word file opened as a document (File > Open; the
/// command is commands/word_import.rs). Unlike the AI's, the text is
/// escaped so it reads back as the same words, line breaks stay breaks,
/// and each picture is handed to `save_image` with its file name and bytes;
/// the src it returns is what the document links to (None: the picture is
/// linked by its path inside the file, and shows as missing).
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
    /// Set when the file is opened as a document (`docx_document`): the src
    /// a picture's relationship target is saved as. It also means the text
    /// is escaped.
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

    /// A paragraph's rendered runs as the lines of one block. Opened as a
    /// document, a line break is a hard break (`\` at the line's end) and
    /// not the soft one that reads as a space, and no line may start a
    /// block of its own.
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

    /// Paragraphs and tables until the Close of the element they sit in (the
    /// body, a table cell, a text box, a note). Everything else - content
    /// controls, custom XML, inserted revisions - is looked through.
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

    /// A picture as `![alt text](media/image1.png)`, from wherever in the
    /// drawing its description and its image sit; text boxes in it go to
    /// `boxed`.
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

/// Alt text on one line, without the brackets that would end it early -
/// MarkItDown's cleanup of slide picture descriptions.
pub(super) fn image_alt(text: &str) -> String {
    text.replace(['[', ']'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

// ---------------------------------------------------------------------------
// styles.xml and numbering.xml
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Style {
    /// Lowercase: the built-in names ("heading 1") are stored in English
    /// whatever the language of Word, while style ids are localized.
    name: String,
    based_on: Option<String>,
    outline: Option<usize>,
    numbering: Option<(usize, String)>,
}

#[derive(Default)]
struct Styles(HashMap<String, Style>);

impl Styles {
    fn parse(xml: &[u8]) -> Self {
        let mut styles = HashMap::new();
        let mut x = Pull::new(xml);
        loop {
            match x.next() {
                Node::Open(tag) if tag.name == "style" => {
                    let id = tag.attr("styleId").unwrap_or_default().to_string();
                    styles.insert(id, style(&mut x));
                }
                Node::End => break,
                _ => {}
            }
        }
        Self(styles)
    }

    fn name(&self, id: &str) -> &str {
        self.0.get(id).map(|s| s.name.as_str()).unwrap_or_default()
    }

    /// The styles `id` is, from itself down the basedOn chain - bounded,
    /// since nothing stops a file from basing two styles on each other.
    fn chain<'a>(&'a self, id: &'a str) -> impl Iterator<Item = &'a Style> + 'a {
        let mut next = Some(id);
        std::iter::from_fn(move || {
            let style = self.0.get(next?)?;
            next = style.based_on.as_deref();
            Some(style)
        })
        .take(8)
    }

    /// A built-in heading style, or one based on it, is a heading of its
    /// level. "Title" only as itself: pandoc's "Author" and "Date" are based
    /// on it, and are not titles.
    fn heading(&self, id: &str) -> Option<usize> {
        if self.name(id) == "title" {
            return Some(1);
        }
        self.chain(id).find_map(|style| {
            let named = style.name.strip_prefix("heading ");
            named
                .and_then(|n| n.trim().parse::<usize>().ok())
                .filter(|level| (1..=9).contains(level))
                .or(style.outline)
        })
    }

    /// Word's "Quote" and "Intense Quote", and the "Block Text" pandoc and
    /// older templates use.
    fn is_quote(&self, id: &str) -> bool {
        self.chain(id).any(|style| {
            matches!(
                style.name.as_str(),
                "quote" | "intense quote" | "block text"
            )
        })
    }

    fn numbering(&self, id: &str) -> Option<(usize, String)> {
        self.chain(id).find_map(|style| style.numbering.clone())
    }
}

fn style(x: &mut Pull) -> Style {
    let mut style = Style::default();
    let mut ilvl = 0;
    let mut depth = 0usize;
    loop {
        match x.next() {
            Node::Open(tag) => {
                match tag.name.as_str() {
                    "name" => style.name = tag.attr("val").unwrap_or_default().to_lowercase(),
                    "basedOn" => style.based_on = tag.attr("val").map(str::to_string),
                    "outlineLvl" => style.outline = heading_of_outline(&tag),
                    "ilvl" => ilvl = tag.attr("val").and_then(|v| v.parse().ok()).unwrap_or(0),
                    "numId" => style.numbering = tag.attr("val").map(|id| (ilvl, id.to_string())),
                    _ => {}
                }
                depth += 1;
            }
            Node::Close if depth == 0 => return style,
            Node::Close => depth -= 1,
            Node::Text(_) => {}
            Node::End => return style,
        }
    }
}

/// Which list levels are bullets, and what number each numbered item
/// shows: numId -> abstractNumId -> each level's numFmt and start, with the
/// numId's own start overrides on top.
#[derive(Default)]
struct Numbering {
    abstract_of: HashMap<String, String>,
    /// (abstractNumId, ilvl) -> numFmt
    formats: HashMap<(String, usize), String>,
    /// (abstractNumId, ilvl) -> w:start
    starts: HashMap<(String, usize), usize>,
    /// (numId, ilvl) -> w:startOverride: Word's "Restart at 1" is a new
    /// numId on the same definition, with this.
    start_overrides: HashMap<(String, usize), usize>,
    /// The number last shown at each level of each numId, counted as the
    /// body is read.
    counters: HashMap<String, Vec<Option<usize>>>,
}

impl Numbering {
    fn parse(xml: &[u8]) -> Self {
        let mut numbering = Self::default();
        let mut x = Pull::new(xml);
        let mut abstract_id = String::new();
        let mut num_id = String::new();
        let mut level = 0;
        let number = |tag: &Tag, name: &str| tag.attr(name).and_then(|v| v.parse().ok());
        loop {
            match x.next() {
                Node::Open(tag) => match tag.name.as_str() {
                    "abstractNum" => {
                        abstract_id = tag.attr("abstractNumId").unwrap_or_default().to_string()
                    }
                    "lvl" => level = number(&tag, "ilvl").unwrap_or(0),
                    "numFmt" => {
                        let format = tag.attr("val").unwrap_or_default().to_string();
                        numbering
                            .formats
                            .insert((abstract_id.clone(), level), format);
                    }
                    "start" => {
                        if let Some(start) = number(&tag, "val") {
                            numbering.starts.insert((abstract_id.clone(), level), start);
                        }
                    }
                    "num" => num_id = tag.attr("numId").unwrap_or_default().to_string(),
                    "abstractNumId" => {
                        let id = tag.attr("val").unwrap_or_default().to_string();
                        numbering.abstract_of.insert(num_id.clone(), id);
                    }
                    // A level override may restate a level's format too; the
                    // abstract definition is close enough to say "bullet".
                    "lvlOverride" => {
                        let level = number(&tag, "ilvl").unwrap_or(0);
                        loop {
                            match x.next() {
                                Node::Open(child) => {
                                    if child.name == "startOverride" {
                                        if let Some(start) = number(&child, "val") {
                                            numbering
                                                .start_overrides
                                                .insert((num_id.clone(), level), start);
                                        }
                                    }
                                    x.skip();
                                }
                                Node::Close | Node::End => break,
                                Node::Text(_) => {}
                            }
                        }
                    }
                    _ => {}
                },
                Node::End => break,
                _ => {}
            }
        }
        numbering
    }

    /// Without a numbering part, or for a level it doesn't define, a list is
    /// taken to be bulleted: "1." would claim an order the file never gave.
    fn is_bullet(&self, num_id: &str, level: usize) -> bool {
        let format = self
            .abstract_of
            .get(num_id)
            .and_then(|a| self.formats.get(&(a.clone(), level)));
        !matches!(format.map(String::as_str), Some(f) if f != "bullet" && f != "none")
    }

    /// The number the next item at `level` of list `num_id` shows, counted
    /// as Word counts: on from the item before it at that level, and from
    /// the level's start again after an item of a higher level. Markdown
    /// keeps a list's first number, so this is what makes a list that starts
    /// at 5, or goes on after a paragraph, read as it does in Word. Letters
    /// and Roman numerals are written as the numbers they count.
    fn next_number(&mut self, num_id: &str, level: usize) -> usize {
        let start = self
            .start_overrides
            .get(&(num_id.to_string(), level))
            .or_else(|| {
                let abstract_id = self.abstract_of.get(num_id)?;
                self.starts.get(&(abstract_id.clone(), level))
            })
            .copied()
            .unwrap_or(1);
        let counters = self.counters.entry(num_id.to_string()).or_default();
        counters.resize(level + 1, None);
        let number = counters[level].map_or(start, |last| last + 1);
        counters[level] = Some(number);
        number
    }
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
mod tests {
    use super::*;

    fn convert(body: &str, parts: &[(&str, &str)]) -> String {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.docx");
        std::fs::write(&path, test_docx_with(body, parts)).unwrap();
        docx_markdown(&path).unwrap()
    }

    fn p(style: &str, text: &str) -> String {
        format!(
            r#"<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>"#
        )
    }

    const STYLES: (&str, &str) = (
        "word/styles.xml",
        r#"<w:styles {W}>
            <w:style w:styleId="Titel"><w:name w:val="Title"/></w:style>
            <w:style w:styleId="berschrift1"><w:name w:val="heading 1"/></w:style>
            <w:style w:styleId="Chapter"><w:name w:val="Chapter"/><w:basedOn w:val="berschrift2"/></w:style>
            <w:style w:styleId="berschrift2"><w:name w:val="heading 2"/></w:style>
            <w:style w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
            <w:style w:styleId="Strong"><w:name w:val="Strong"/></w:style>
            <w:style w:styleId="Author"><w:name w:val="Author"/><w:basedOn w:val="Titel"/></w:style>
            <w:style w:styleId="Zitat"><w:name w:val="Quote"/></w:style>
        </w:styles>"#,
    );

    #[test]
    fn heading_styles_become_headings_by_name_not_id() {
        // German Word's ids ("berschrift1") with the English built-in names
        // Word stores whatever its language; "Chapter" is based on heading 2.
        let body = [
            p("Titel", "Book"),
            p("Author", "Ann"),
            p("berschrift1", "Part one"),
            r#"<w:p><w:pPr><w:pStyle w:val="Chapter"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>A chapter</w:t></w:r></w:p>"#.to_string(),
            p("Zitat", "Quoted."),
            p("Normal", "Text."),
        ]
        .concat();
        // pandoc's "Author" is based on "Title" and is no heading; a bold
        // heading is just a heading.
        assert_eq!(
            convert(&body, &[STYLES]),
            "# Book\n\nAnn\n\n# Part one\n\n## A chapter\n\n> Quoted.\n\nText."
        );
    }

    #[test]
    fn lists_are_numbered_or_bulleted_as_the_numbering_part_says() {
        let numbering = (
            "word/numbering.xml",
            r#"<w:numbering {W}>
                <w:abstractNum w:abstractNumId="5"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
                <w:abstractNum w:abstractNumId="6"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
                <w:num w:numId="1"><w:abstractNumId w:val="6"/></w:num>
                <w:num w:numId="2"><w:abstractNumId w:val="5"/></w:num>
            </w:numbering>"#,
        );
        let item = |ilvl: u8, num: u8, text: &str| {
            format!(
                r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="{ilvl}"/><w:numId w:val="{num}"/></w:numPr></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>"#
            )
        };
        let body = [
            item(0, 2, "First"),
            item(1, 2, "Detail"),
            item(0, 2, "Second"),
            p("Normal", "Between."),
            p("ListBullet", "Styled bullet"),
        ]
        .concat();
        assert_eq!(
            convert(&body, &[STYLES, numbering]),
            "1. First\n    - Detail\n2. Second\n\nBetween.\n\n- Styled bullet"
        );
    }

    #[test]
    fn emphasis_links_and_breaks_survive() {
        let rels = (
            "word/_rels/document.xml.rels",
            r#"<Relationships><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/" TargetMode="External"/></Relationships>"#,
        );
        let body = r#"<w:p>
            <w:r><w:t xml:space="preserve">Plain </w:t></w:r>
            <w:r><w:rPr><w:b/></w:rPr><w:t>bo</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ld</w:t></w:r>
            <w:r><w:rPr><w:b w:val="0"/><w:i/></w:rPr><w:t xml:space="preserve"> italic</w:t></w:r>
            <w:r><w:rPr><w:rStyle w:val="Strong"/></w:rPr><w:t xml:space="preserve"> strong</w:t></w:r>
            <w:r><w:t xml:space="preserve"> and </w:t></w:r>
            <w:hyperlink r:id="rId9"><w:r><w:t>a link</w:t></w:r></w:hyperlink>
            <w:r><w:br/><w:t>Tom &amp; Jerry</w:t></w:r>
            <w:del><w:r><w:delText>gone</w:delText></w:r></w:del>
        </w:p>"#;
        assert_eq!(
            convert(body, &[STYLES, rels]),
            "Plain **bold** *italic* **strong** and [a link](https://example.com/)\nTom & Jerry"
        );
    }

    #[test]
    fn tables_become_pipe_tables() {
        let cell = |text: &str| format!("<w:tc><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:tc>");
        let body = format!(
            r#"<w:tbl><w:tblPr/><w:tblGrid/>
                <w:tr>{}{}</w:tr>
                <w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>wide</w:t></w:r></w:p><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr>
                <w:tr>{}{}</w:tr>
            </w:tbl>"#,
            cell("Name"),
            cell("Age"),
            cell("Ann"),
            cell("41")
        );
        assert_eq!(
            convert(&body, &[]),
            "| Name | Age |\n| --- | --- |\n| wide<br>cell |  |\n| Ann | 41 |"
        );
    }

    #[test]
    fn footnotes_are_numbered_by_first_reference_and_listed_at_the_end() {
        let notes = (
            "word/footnotes.xml",
            r#"<w:footnotes {W}>
                <w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
                <w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Smith, 1999.</w:t></w:r></w:p></w:footnote>
                <w:footnote w:id="2"><w:p><w:r><w:t>Ibid.</w:t></w:r></w:p></w:footnote>
            </w:footnotes>"#,
        );
        let body = r#"<w:p><w:r><w:t>Claim</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r><w:r><w:t xml:space="preserve"> and another</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:t>.</w:t></w:r></w:p>"#;
        assert_eq!(
            convert(body, &[notes]),
            "Claim[^1] and another[^2].\n\n[^1]: Ibid.\n\n[^2]: Smith, 1999."
        );
    }

    #[test]
    fn images_keep_their_alt_text_and_drawings_are_read_once() {
        let rels = (
            "word/_rels/document.xml.rels",
            r#"<Relationships><Relationship Id="rId4" Type="image" Target="media/image1.png"/></Relationships>"#,
        );
        let body = r#"<w:p><w:r><mc:AlternateContent xmlns:mc="mc">
            <mc:Choice><w:drawing><wp:inline xmlns:wp="wp"><wp:docPr id="1" name="Picture 1" descr="A [red] barn"/>
                <a:graphic xmlns:a="a"><a:graphicData><pic:pic xmlns:pic="pic"><pic:blipFill><a:blip r:embed="rId4"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>
            </wp:inline></w:drawing></mc:Choice>
            <mc:Fallback><w:pict><v:imagedata xmlns:v="v" r:id="rId4"/></w:pict></mc:Fallback>
        </mc:AlternateContent></w:r></w:p>"#;
        assert_eq!(convert(body, &[rels]), "![A red barn](media/image1.png)");
    }

    #[test]
    fn numbered_items_show_the_number_word_shows() {
        // Level 0 starts at 5; numId 3 is "Restart at 1" on the same list.
        let numbering = (
            "word/numbering.xml",
            r#"<w:numbering {W}>
                <w:abstractNum w:abstractNumId="0">
                    <w:lvl w:ilvl="0"><w:start w:val="5"/><w:numFmt w:val="decimal"/></w:lvl>
                    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/></w:lvl>
                </w:abstractNum>
                <w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num>
                <w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
            </w:numbering>"#,
        );
        let item = |ilvl: u8, num: u8, text: &str| {
            format!(
                r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="{ilvl}"/><w:numId w:val="{num}"/></w:numPr></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>"#
            )
        };
        let body = [
            item(0, 2, "Five"),
            item(1, 2, "a"),
            item(1, 2, "b"),
            item(0, 2, "Six"),
            item(1, 2, "a again"),
            p("Normal", "Between."),
            item(0, 2, "Seven, after the paragraph"),
            item(0, 3, "Restarted"),
            item(0, 3, "Two"),
        ]
        .concat();
        assert_eq!(
            convert(&body, &[numbering]),
            "5. Five\n    1. a\n    2. b\n6. Six\n    1. a again\n\nBetween.\n\n\
             7. Seven, after the paragraph\n1. Restarted\n2. Two"
        );
    }

    /// `body` opened as a document, with the pictures it saved: (name in
    /// the file, bytes).
    fn open(body: &str, parts: &[(&str, &str)]) -> (String, Vec<(String, Vec<u8>)>) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.docx");
        std::fs::write(&path, test_docx_with(body, parts)).unwrap();
        let mut saved = Vec::new();
        let markdown = docx_document(&path, &mut |name, bytes| {
            saved.push((name.to_string(), bytes.to_vec()));
            Some(format!("/drafts/image-{}.png", saved.len()))
        })
        .unwrap();
        (markdown, saved)
    }

    /// `text` as the runs of one paragraph: a `\n` is a line break.
    fn runs(text: &str) -> String {
        text.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .split('\n')
            .map(|line| format!(r#"<w:r><w:t xml:space="preserve">{line}</w:t></w:r>"#))
            .collect::<Vec<_>>()
            .join("<w:r><w:br/></w:r>")
    }

    /// Each block's text as a CommonMark reader reads `markdown` back:
    /// paragraphs, headings, list items, table cells and footnote
    /// definitions, a hard break as `\n`. Anything read as markup is named.
    fn read_back(markdown: &str) -> Vec<String> {
        use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
        let options = Options::ENABLE_TABLES
            | Options::ENABLE_FOOTNOTES
            | Options::ENABLE_STRIKETHROUGH
            | Options::ENABLE_MATH;
        let mut blocks = Vec::new();
        let mut text = String::new();
        let mut flush = |text: &mut String| {
            if !text.is_empty() {
                blocks.push(std::mem::take(text));
            }
        };
        for event in Parser::new_ext(markdown, options) {
            match event {
                Event::Text(t) => text.push_str(&t),
                Event::Code(t) => text.push_str(&format!("<code {t}>")),
                Event::InlineMath(t) | Event::DisplayMath(t) => {
                    text.push_str(&format!("<math {t}>"))
                }
                Event::InlineHtml(t) | Event::Html(t) => text.push_str(&format!("<html {t}>")),
                Event::SoftBreak => text.push(' '),
                Event::HardBreak => text.push('\n'),
                Event::FootnoteReference(label) => text.push_str(&format!("[^{label}]")),
                Event::Start(
                    Tag::Emphasis | Tag::Strong | Tag::Strikethrough | Tag::Link { .. },
                ) => text.push_str("<markup>"),
                Event::Start(Tag::List(_) | Tag::Item)
                | Event::End(
                    TagEnd::Paragraph
                    | TagEnd::Heading(_)
                    | TagEnd::Item
                    | TagEnd::TableCell
                    | TagEnd::FootnoteDefinition,
                ) => flush(&mut text),
                _ => {}
            }
        }
        flush(&mut text);
        blocks
    }

    #[derive(serde::Deserialize)]
    struct WordText {
        heading: String,
        paragraphs: Vec<String>,
        table: Vec<Vec<String>>,
    }

    /// The text of testdata/word-text.json as Word would hold it, opened:
    /// the Markdown is testdata/word-text.md, which the frontend's test reads
    /// back through the editor itself (src/document-view/word-text.test.ts).
    #[test]
    fn opened_as_a_document_text_reads_back_as_the_same_words() {
        let fixture: WordText =
            serde_json::from_str(include_str!("testdata/word-text.json")).unwrap();
        let row = |cells: &Vec<String>| {
            let cells: String = cells
                .iter()
                .map(|c| format!("<w:tc><w:p>{}</w:p></w:tc>", runs(c)))
                .collect();
            format!("<w:tr>{cells}</w:tr>")
        };
        let body = [
            format!(
                r#"<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr>{}</w:p>"#,
                runs(&fixture.heading)
            ),
            fixture
                .paragraphs
                .iter()
                .map(|text| format!("<w:p>{}</w:p>", runs(text)))
                .collect(),
            format!(
                "<w:tbl>{}</w:tbl>",
                fixture.table.iter().map(row).collect::<String>()
            ),
        ]
        .concat();
        let (markdown, _) = open(&body, &[]);
        assert_eq!(markdown, include_str!("testdata/word-text.md").trim_end());

        let mut expected = vec![fixture.heading.clone()];
        expected.extend(fixture.paragraphs.iter().cloned());
        expected.extend(fixture.table.iter().flatten().cloned());
        assert_eq!(read_back(&markdown), expected);
        // The AI reads the same file as written, unescaped.
        assert!(convert(&body, &[]).contains("Price: $5 and $10, *each* or _two_"));
    }

    #[test]
    fn opened_as_a_document_emphasis_lists_and_footnotes_still_mean_markdown() {
        let notes = (
            "word/footnotes.xml",
            r#"<w:footnotes {W}><w:footnote w:id="1"><w:p><w:r><w:t xml:space="preserve">See [1], p. 5*</w:t></w:r></w:p></w:footnote></w:footnotes>"#,
        );
        let numbering = (
            "word/numbering.xml",
            r#"<w:numbering {W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>"#,
        );
        let body = r#"
            <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>2 * 3</w:t></w:r><w:r><w:t xml:space="preserve"> is six</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>
            <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>1. item</w:t></w:r><w:r><w:br/><w:t># line</w:t></w:r></w:p>
            <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>_two_</w:t></w:r></w:p>"#;
        let (markdown, _) = open(body, &[notes, numbering]);
        assert_eq!(
            markdown,
            "**2 \\* 3** is six[^1]\n\n1. 1\\. item\\\n   \\# line\n2. \\_two\\_\n\n[^1]: See \\[1], p. 5\\*"
        );
        assert_eq!(
            read_back(&markdown),
            [
                "<markup>2 * 3 is six[^1]",
                "1. item\n# line",
                "_two_",
                "See [1], p. 5*"
            ]
        );
    }

    #[test]
    fn opened_as_a_document_pictures_are_saved_once_and_linked() {
        let rels = (
            "word/_rels/document.xml.rels",
            r#"<Relationships>
                <Relationship Id="rId4" Type="image" Target="media/image1.png"/>
                <Relationship Id="rId5" Type="image" Target="https://example.com/logo.png" TargetMode="External"/>
            </Relationships>"#,
        );
        let picture = |id: &str, alt: &str| {
            format!(
                r#"<w:p><w:r><w:drawing><wp:inline xmlns:wp="wp"><wp:docPr id="1" descr="{alt}"/><a:graphic xmlns:a="a"><a:graphicData><pic:pic xmlns:pic="pic"><pic:blipFill><a:blip r:embed="{id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#
            )
        };
        let body = [
            picture("rId4", "A barn"),
            picture("rId4", "The barn again"),
            picture("rId5", "Logo"),
        ]
        .concat();
        let (markdown, saved) = open(&body, &[rels, ("word/media/image1.png", "PNG bytes")]);
        assert_eq!(
            markdown,
            "![A barn](/drafts/image-1.png)\n\n![The barn again](/drafts/image-1.png)\n\n![Logo](https://example.com/logo.png)"
        );
        assert_eq!(saved, [("image1.png".to_string(), b"PNG bytes".to_vec())]);
    }
}
