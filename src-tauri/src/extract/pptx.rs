//! PowerPoint (.pptx) to Markdown: one `## Slide N: title` per slide, the
//! body placeholders as lists, text boxes as paragraphs, tables, pictures by
//! their alt text, and the speaker notes under `### Notes`.
//!
//! The approach is MarkItDown's (github.com/microsoft/markitdown, MIT;
//! converters/_pptx_converter.py): the title placeholder heads the slide,
//! the other shapes follow top to bottom, then left to right - the order
//! they are read on the slide, which the order in the file (z-order) is not -
//! with group members sorted the same way inside their group, and a notes
//! section only when the notes say something.

use super::docx::image_alt;
use super::markdown::{self, Blocks, Inline, Marks};
use super::xml::{resolve_part, zip_entry, Node, Pull, Rels};
use std::path::Path;

pub(super) fn pptx_markdown(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|_| "This .pptx is not a readable PowerPoint file.".to_string())?;

    // Slides are `ppt/slides/slide1.xml`, `slide2.xml`, ... - which sort
    // wrong as strings (slide10 before slide2), so order by the number.
    let mut slides: Vec<(u32, String)> = zip
        .file_names()
        .filter_map(|name| {
            let rest = name.strip_prefix("ppt/slides/slide")?;
            let number = rest.strip_suffix(".xml")?.parse::<u32>().ok()?;
            Some((number, name.to_string()))
        })
        .collect();
    slides.sort();

    let mut out = Vec::new();
    for (number, name) in slides {
        let Some(xml) = zip_entry(&mut zip, &name) else {
            continue;
        };
        let rels_name = format!("ppt/slides/_rels/slide{number}.xml.rels");
        let rels = Rels::parse(&zip_entry(&mut zip, &rels_name).unwrap_or_default());
        let (title, body) = read_slide(&xml, &rels, true);

        let notes = rels
            .of_kind("notesSlide")
            .map(|target| resolve_part("ppt/slides", target))
            .and_then(|notes| zip_entry(&mut zip, &notes))
            .map(|xml| read_slide(&xml, &Rels::default(), false).1)
            .unwrap_or_default();

        if title.is_none() && body.is_empty() && notes.is_empty() {
            continue;
        }
        let mut slide = match title {
            Some(title) => format!("## Slide {number}: {title}"),
            None => format!("## Slide {number}"),
        };
        if !body.is_empty() {
            slide.push_str("\n\n");
            slide.push_str(&body);
        }
        if !notes.is_empty() {
            slide.push_str("\n\n### Notes\n\n");
            slide.push_str(&notes);
        }
        out.push(slide);
    }

    if out.is_empty() {
        return Err("This presentation has no extractable text.".to_string());
    }
    Ok(out.join("\n\n"))
}

/// A slide's (or notes page's) title and the Markdown of everything else.
/// `bullets` is whether body placeholders are bulleted, as they are on a
/// slide and are not on a notes page.
fn read_slide(xml: &[u8], rels: &Rels, bullets: bool) -> (Option<String>, String) {
    let reader = SlideReader { rels, bullets };
    let mut x = Pull::new(xml);
    let mut shapes = Vec::new();
    loop {
        match x.next() {
            Node::Open(tag) if tag.name == "spTree" => shapes = reader.tree(&mut x).0,
            Node::End => break,
            _ => {}
        }
    }
    sort(&mut shapes);
    let title = shapes
        .iter()
        .position(|shape| shape.title)
        .map(|i| shapes.remove(i).markdown);
    let mut body = Blocks::default();
    for shape in shapes {
        body.push(&shape.markdown);
    }
    (title, body.finish())
}

struct Shape {
    /// Top-left corner in EMU; unknown (a placeholder that inherits its
    /// place from the layout) sorts first, as in MarkItDown.
    at: (i64, i64),
    title: bool,
    markdown: String,
}

const UNPLACED: (i64, i64) = (i64::MIN, i64::MIN);

fn sort(shapes: &mut [Shape]) {
    shapes.sort_by_key(|shape| shape.at);
}

struct SlideReader<'a> {
    rels: &'a Rels,
    bullets: bool,
}

/// How a paragraph is marked as a list item.
#[derive(Clone, Copy, PartialEq)]
enum Bullet {
    Inherited,
    None,
    Char,
    Number,
}

impl SlideReader<'_> {
    /// The shapes of a shape tree or group, through its Close, and the
    /// group's own position.
    fn tree(&self, x: &mut Pull) -> (Vec<Shape>, (i64, i64)) {
        let mut shapes = Vec::new();
        let mut at = UNPLACED;
        let mut depth = 0usize;
        loop {
            match x.next() {
                Node::Open(tag) => match tag.name.as_str() {
                    "sp" => shapes.extend(self.text_shape(x)),
                    "graphicFrame" => shapes.extend(self.frame(x)),
                    "pic" => shapes.extend(self.picture(x)),
                    "grpSp" => {
                        let (mut members, at) = self.tree(x);
                        sort(&mut members);
                        let mut blocks = Blocks::default();
                        for member in members {
                            blocks.push(&member.markdown);
                        }
                        shapes.push(Shape {
                            at,
                            title: false,
                            markdown: blocks.finish(),
                        });
                    }
                    "grpSpPr" => at = offset(x),
                    "AlternateContent" | "Choice" => depth += 1,
                    _ => x.skip(),
                },
                Node::Close if depth == 0 => break,
                Node::Close => depth -= 1,
                Node::Text(_) => {}
                Node::End => break,
            }
        }
        (
            shapes
                .into_iter()
                .filter(|s| !s.markdown.is_empty())
                .collect(),
            at,
        )
    }

    fn text_shape(&self, x: &mut Pull) -> Option<Shape> {
        let mut placeholder = None;
        let mut at = UNPLACED;
        let mut paragraphs = Vec::new();
        let mut depth = 0usize;
        loop {
            match x.next() {
                Node::Open(tag) => match tag.name.as_str() {
                    "ph" => {
                        // A placeholder without a type is the layout's body.
                        placeholder = Some(tag.attr("type").unwrap_or("body").to_string());
                        x.skip();
                    }
                    "off" if at == UNPLACED => {
                        at = position(&tag);
                        x.skip();
                    }
                    "txBody" => paragraphs = self.text_body(x),
                    _ => depth += 1,
                },
                Node::Close if depth == 0 => break,
                Node::Close => depth -= 1,
                Node::Text(_) => {}
                Node::End => break,
            }
        }
        let title = match placeholder.as_deref() {
            Some("title" | "ctrTitle") => true,
            // Slide number, date, footer: the template's furniture, the same
            // on every slide. The slide image on a notes page is no text.
            Some("sldNum" | "dt" | "ftr" | "hdr" | "sldImg") => return None,
            _ => false,
        };
        let bulleted = self.bullets && matches!(placeholder.as_deref(), Some(p) if p != "subTitle");
        let markdown = if title {
            let lines: Vec<String> = paragraphs
                .iter()
                .map(|(_, _, line)| line.render_plain())
                .collect();
            lines
                .join(" ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        } else {
            body_markdown(&paragraphs, bulleted)
        };
        Some(Shape {
            at,
            title,
            markdown,
        })
    }

    /// `(level, bullet, text)` for each paragraph of a text body.
    fn text_body(&self, x: &mut Pull) -> Vec<(usize, Bullet, Inline)> {
        let mut paragraphs = Vec::new();
        loop {
            match x.next() {
                Node::Open(tag) if tag.name == "p" => paragraphs.push(self.paragraph(x)),
                Node::Open(_) => x.skip(),
                Node::Close | Node::End => return paragraphs,
                Node::Text(_) => {}
            }
        }
    }

    fn paragraph(&self, x: &mut Pull) -> (usize, Bullet, Inline) {
        let mut level = 0;
        let mut bullet = Bullet::Inherited;
        let mut line = Inline::default();
        loop {
            let tag = match x.next() {
                Node::Open(tag) => tag,
                Node::Close | Node::End => break,
                Node::Text(_) => continue,
            };
            match tag.name.as_str() {
                "pPr" => {
                    level = tag.attr("lvl").and_then(|l| l.parse().ok()).unwrap_or(0);
                    bullet = bullet_of(x);
                }
                // A field (slide number, date) is a run.
                "r" | "fld" => self.run(x, &mut line),
                "br" => {
                    x.skip();
                    line.push("\n", Marks::default(), None);
                }
                _ => x.skip(),
            }
        }
        (level, bullet, line)
    }

    fn run(&self, x: &mut Pull, line: &mut Inline) {
        let mut marks = Marks::default();
        let mut link = None;
        loop {
            let tag = match x.next() {
                Node::Open(tag) => tag,
                Node::Close | Node::End => return,
                Node::Text(_) => continue,
            };
            match tag.name.as_str() {
                "rPr" => {
                    marks = Marks {
                        bold: tag.attr("b").is_some_and(on),
                        italic: tag.attr("i").is_some_and(on),
                        strike: tag.attr("strike").is_some_and(|s| s != "noStrike"),
                    };
                    link = self.run_link(x);
                }
                "t" => line.push(&x.text(), marks, link.as_deref()),
                _ => x.skip(),
            }
        }
    }

    /// The URL of an `<a:hlinkClick>` inside the `<a:rPr>` just opened.
    fn run_link(&self, x: &mut Pull) -> Option<String> {
        let mut link = None;
        let mut depth = 0usize;
        loop {
            match x.next() {
                Node::Open(tag) => {
                    if tag.name == "hlinkClick" {
                        link = tag
                            .attr("id")
                            .and_then(|id| self.rels.link(id))
                            .map(str::to_string);
                    }
                    depth += 1;
                }
                Node::Close if depth == 0 => return link,
                Node::Close => depth -= 1,
                Node::Text(_) => {}
                Node::End => return link,
            }
        }
    }

    /// A table frame. Charts and SmartArt live in parts of their own and
    /// are not read.
    fn frame(&self, x: &mut Pull) -> Option<Shape> {
        let mut at = UNPLACED;
        let mut rows: Vec<Vec<String>> = Vec::new();
        let mut depth = 0usize;
        loop {
            match x.next() {
                Node::Open(tag) => match tag.name.as_str() {
                    "off" if at == UNPLACED => {
                        at = position(&tag);
                        x.skip();
                    }
                    "tr" => {
                        rows.push(Vec::new());
                        depth += 1;
                    }
                    "tc" => {
                        let mut cell = Vec::new();
                        loop {
                            match x.next() {
                                Node::Open(tag) if tag.name == "txBody" => {
                                    for (_, _, line) in self.text_body(x) {
                                        cell.push(line.render());
                                    }
                                }
                                Node::Open(_) => x.skip(),
                                Node::Close | Node::End => break,
                                Node::Text(_) => {}
                            }
                        }
                        if let Some(row) = rows.last_mut() {
                            row.push(cell.join("\n"));
                        }
                    }
                    _ => depth += 1,
                },
                Node::Close if depth == 0 => break,
                Node::Close => depth -= 1,
                Node::Text(_) => {}
                Node::End => break,
            }
        }
        (!rows.is_empty()).then(|| Shape {
            at,
            title: false,
            markdown: markdown::table(&rows),
        })
    }

    /// `![alt text](image3.png)`; MarkItDown falls back on the shape's name
    /// ("Picture 3") when there is no description, and so does this.
    fn picture(&self, x: &mut Pull) -> Option<Shape> {
        let mut at = UNPLACED;
        let mut alt = String::new();
        let mut file = String::new();
        let mut depth = 0usize;
        loop {
            match x.next() {
                Node::Open(tag) => {
                    match tag.name.as_str() {
                        "cNvPr" => {
                            let descr = tag.attr("descr").filter(|d| !d.trim().is_empty());
                            alt = image_alt(descr.or(tag.attr("name")).unwrap_or_default());
                        }
                        "blip" => {
                            let target = tag.attr("embed").and_then(|id| self.rels.target(id));
                            file = target
                                .map(|t| t.rsplit('/').next().unwrap_or(t))
                                .unwrap_or_default()
                                .to_string();
                        }
                        "off" if at == UNPLACED => at = position(&tag),
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
        if alt.is_empty() && file.is_empty() {
            return None;
        }
        Some(Shape {
            at,
            title: false,
            markdown: format!("![{alt}]({})", markdown::link_target(&file)),
        })
    }
}

fn body_markdown(paragraphs: &[(usize, Bullet, Inline)], bulleted: bool) -> String {
    let mut blocks = Blocks::default();
    for (level, bullet, line) in paragraphs {
        let text = line.render();
        match bullet {
            Bullet::Number => blocks.push_item(*level, "1.", &text),
            Bullet::Char => blocks.push_item(*level, "-", &text),
            Bullet::Inherited if bulleted => blocks.push_item(*level, "-", &text),
            _ => blocks.push(&text),
        }
    }
    blocks.finish()
}

/// The bullet an `<a:pPr>` sets, through its Close.
fn bullet_of(x: &mut Pull) -> Bullet {
    let mut bullet = Bullet::Inherited;
    let mut depth = 0usize;
    loop {
        match x.next() {
            Node::Open(tag) => {
                match tag.name.as_str() {
                    "buNone" => bullet = Bullet::None,
                    "buChar" | "buBlip" => bullet = Bullet::Char,
                    "buAutoNum" => bullet = Bullet::Number,
                    _ => {}
                }
                depth += 1;
            }
            Node::Close if depth == 0 => return bullet,
            Node::Close => depth -= 1,
            Node::Text(_) => {}
            Node::End => return bullet,
        }
    }
}

/// The first `<a:off>` inside the element just opened, through its Close.
fn offset(x: &mut Pull) -> (i64, i64) {
    let mut at = UNPLACED;
    let mut depth = 0usize;
    loop {
        match x.next() {
            Node::Open(tag) => {
                if tag.name == "off" && at == UNPLACED {
                    at = position(&tag);
                }
                depth += 1;
            }
            Node::Close if depth == 0 => return at,
            Node::Close => depth -= 1,
            Node::Text(_) => {}
            Node::End => return at,
        }
    }
}

/// (y, x): rows first, as a slide is read.
fn position(tag: &super::xml::Tag) -> (i64, i64) {
    let coord = |name| tag.attr(name).and_then(|v| v.parse().ok()).unwrap_or(0);
    (coord("y"), coord("x"))
}

fn on(value: &str) -> bool {
    matches!(value, "1" | "true")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A .pptx of `slides` (each the inside of `<p:spTree>`) with optional
    /// extra parts.
    fn test_pptx(slides: &[&str], parts: &[(&str, &str)]) -> Vec<u8> {
        use std::io::Write;
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (i, tree) in slides.iter().enumerate() {
            zip.start_file(format!("ppt/slides/slide{}.xml", i + 1), options)
                .unwrap();
            let xml = format!(
                r#"<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>{tree}</p:spTree></p:cSld></p:sld>"#
            );
            zip.write_all(xml.as_bytes()).unwrap();
        }
        for (name, content) in parts {
            zip.start_file(*name, options).unwrap();
            zip.write_all(content.as_bytes()).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    fn convert(slides: &[&str], parts: &[(&str, &str)]) -> Result<String, String> {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.pptx");
        std::fs::write(&path, test_pptx(slides, parts)).unwrap();
        pptx_markdown(&path)
    }

    fn sp(ph: &str, y: i64, paragraphs: &str) -> String {
        format!(
            r#"<p:sp><p:nvSpPr><p:nvPr>{ph}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="{y}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/>{paragraphs}</p:txBody></p:sp>"#
        )
    }

    fn para(text: &str) -> String {
        format!("<a:p><a:r><a:t>{text}</a:t></a:r></a:p>")
    }

    #[test]
    fn slides_get_their_title_body_list_and_notes() {
        let body = format!(
            "{}{}{}",
            para("Why"),
            r#"<a:p><a:pPr lvl="1"/><a:r><a:rPr b="1"/><a:t>Because</a:t></a:r></a:p>"#,
            r#"<a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>Aside</a:t></a:r></a:p>"#
        );
        // In the file the body comes first, the footer is template
        // furniture, and the text box sits below the body on the slide.
        let slide = [
            sp(r#"<p:ph idx="1"/>"#, 100, &body),
            sp("", 900, &para("A text box")),
            sp(r#"<p:ph type="sldNum"/>"#, 999, &para("7")),
            sp(r#"<p:ph type="title"/>"#, 0, &para("The plan")),
        ]
        .concat();
        let notes = sp(r#"<p:ph type="body" idx="1"/>"#, 0, &para("Say it slowly."));
        let notes_slide = format!(
            r#"<p:notes xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>{notes}</p:spTree></p:cSld></p:notes>"#
        );
        let parts = [
            (
                "ppt/slides/_rels/slide1.xml.rels",
                r#"<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>"#,
            ),
            ("ppt/notesSlides/notesSlide1.xml", notes_slide.as_str()),
        ];
        assert_eq!(
            convert(&[&slide], &parts).unwrap(),
            "## Slide 1: The plan\n\n- Why\n    - **Because**\n\nAside\n\nA text box\n\n### Notes\n\nSay it slowly."
        );
    }

    #[test]
    fn tables_pictures_and_groups_are_read_in_place() {
        let cell = |t: &str| format!("<a:tc><a:txBody>{}</a:txBody><a:tcPr/></a:tc>", para(t));
        let table = format!(
            r#"<p:graphicFrame><p:xfrm><a:off x="0" y="500"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblGrid/><a:tr>{}{}</a:tr><a:tr>{}{}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>"#,
            cell("Q"),
            cell("Sales"),
            cell("Q1"),
            cell("12")
        );
        let picture = r#"<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 3" descr="Sales chart"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="200"/></a:xfrm></p:spPr></p:pic>"#;
        let group = format!(
            r#"<p:grpSp><p:nvGrpSpPr/><p:grpSpPr><a:xfrm><a:off x="0" y="100"/></a:xfrm></p:grpSpPr>{}{}</p:grpSp>"#,
            sp("", 20, &para("second in group")),
            sp("", 10, &para("first in group"))
        );
        let slide = [table, picture.to_string(), group].concat();
        let rels = (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rId3" Type="image" Target="../media/image3.png"/></Relationships>"#,
        );
        assert_eq!(
            convert(&[&slide], &[rels]).unwrap(),
            "## Slide 1\n\nfirst in group\n\nsecond in group\n\n![Sales chart](image3.png)\n\n| Q | Sales |\n| --- | --- |\n| Q1 | 12 |"
        );
    }

    #[test]
    fn slides_are_numbered_by_file_and_empty_ones_dropped() {
        let empty = String::new();
        let titled = sp(
            r#"<p:ph type="ctrTitle"/>"#,
            0,
            &para("Hello &amp; welcome"),
        );
        let mut slides = vec![empty.as_str(); 9];
        slides.push(&titled);
        assert_eq!(
            convert(&slides, &[]).unwrap(),
            "## Slide 10: Hello & welcome"
        );
        assert_eq!(
            convert(&[&empty], &[]).unwrap_err(),
            "This presentation has no extractable text."
        );
    }
}
