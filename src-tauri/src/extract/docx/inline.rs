//! Inside a paragraph: runs and their marks, links, note references,
//! breaks and pictures, as Markdown inline text.

use super::*;

impl Docx<'_> {
    /// One element inside a paragraph, whose Open was just read.
    pub(super) fn inline(
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
}
