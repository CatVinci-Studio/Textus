//! A document's Markdown parsed into blocks of prose, each with a map back
//! to the source: code, math, front matter and HTML never reach a rule.
//! Images and links are kept for the rules on alt and link text.

use crate::ai::rules::text::PLACEHOLDER;
use crate::ai::rules::Block;
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};

/// One block of prose and where each of its chars came from.
pub(super) struct BlockText {
    pub(super) kind: Block,
    pub(super) text: String,
    /// Char index in `text` -> char offset in the source.
    pub(super) map: Vec<usize>,
}

impl BlockText {
    fn push(&mut self, c: char, at: usize) {
        self.text.push(c);
        self.map.push(at);
    }
}

pub(super) struct Image {
    pub(super) start: usize,
    pub(super) end: usize,
    pub(super) alt: String,
}

pub(super) struct Link {
    pub(super) start: usize,
    pub(super) end: usize,
    pub(super) text: String,
}

/// The parsed document.
pub(super) struct Parsed {
    pub(super) blocks: Vec<BlockText>,
    pub(super) images: Vec<Image>,
    pub(super) links: Vec<Link>,
    /// (level, block index) for each heading.
    pub(super) headings: Vec<(u8, usize)>,
}

pub(super) fn parse(markdown: &str) -> Parsed {
    // Byte offset -> char offset.
    let mut b2c = vec![0usize; markdown.len() + 1];
    for (ci, (bi, ch)) in markdown.char_indices().enumerate() {
        for slot in b2c.iter_mut().skip(bi).take(ch.len_utf8()) {
            *slot = ci;
        }
    }
    b2c[markdown.len()] = markdown.chars().count();
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_MATH
        | Options::ENABLE_YAML_STYLE_METADATA_BLOCKS;
    let mut parsed = Parsed {
        blocks: Vec::new(),
        images: Vec::new(),
        links: Vec::new(),
        headings: Vec::new(),
    };
    let mut current: Option<BlockText> = None;
    let mut skip = 0usize; // inside code blocks, metadata, images
    let mut quote_depth = 0usize;
    let mut item_depth = 0usize;
    let mut image: Option<Image> = None;
    let mut link: Option<Link> = None;
    let close = |current: &mut Option<BlockText>, parsed: &mut Parsed| {
        if let Some(b) = current.take() {
            if b.text.trim().is_empty() {
                return;
            }
            if let Block::Heading(level) = b.kind {
                parsed.headings.push((level, parsed.blocks.len()));
            }
            parsed.blocks.push(b);
        }
    };
    let open = |kind: Block| BlockText {
        kind,
        text: String::new(),
        map: Vec::new(),
    };
    for (event, range) in Parser::new_ext(markdown, options).into_offset_iter() {
        let start = b2c[range.start];
        let end = b2c[range.end];
        match event {
            Event::Start(Tag::CodeBlock(_))
            | Event::Start(Tag::MetadataBlock(_))
            | Event::Start(Tag::HtmlBlock) => skip += 1,
            Event::End(TagEnd::CodeBlock)
            | Event::End(TagEnd::MetadataBlock(_))
            | Event::End(TagEnd::HtmlBlock) => skip = skip.saturating_sub(1),
            _ if skip > 0 => {}
            Event::Start(Tag::Image { .. }) => {
                image = Some(Image {
                    start,
                    end,
                    alt: String::new(),
                });
            }
            Event::End(TagEnd::Image) => {
                if let Some(img) = image.take() {
                    parsed.images.push(img);
                }
                if let Some(b) = current.as_mut() {
                    b.push(PLACEHOLDER, start);
                }
            }
            Event::Text(t) if image.is_some() => {
                if let Some(img) = image.as_mut() {
                    img.alt.push_str(&t);
                }
            }
            Event::Start(Tag::BlockQuote(_)) => quote_depth += 1,
            Event::End(TagEnd::BlockQuote(_)) => quote_depth = quote_depth.saturating_sub(1),
            Event::Start(Tag::Paragraph) => {
                if current.is_none() {
                    let kind = if item_depth > 0 {
                        Block::ListItem
                    } else if quote_depth > 0 {
                        Block::Quote
                    } else {
                        Block::Paragraph
                    };
                    current = Some(open(kind));
                }
            }
            Event::End(TagEnd::Paragraph) => close(&mut current, &mut parsed),
            Event::Start(Tag::Heading { level, .. }) => {
                close(&mut current, &mut parsed);
                current = Some(open(Block::Heading(level as u8)));
            }
            Event::End(TagEnd::Heading(_)) => close(&mut current, &mut parsed),
            Event::Start(Tag::Item) => {
                close(&mut current, &mut parsed);
                item_depth += 1;
                current = Some(open(Block::ListItem));
            }
            Event::End(TagEnd::Item) => {
                close(&mut current, &mut parsed);
                item_depth = item_depth.saturating_sub(1);
            }
            Event::Start(Tag::TableCell) => {
                close(&mut current, &mut parsed);
                current = Some(open(Block::TableCell));
            }
            Event::End(TagEnd::TableCell) => close(&mut current, &mut parsed),
            Event::Start(Tag::Link { .. }) => {
                link = Some(Link {
                    start,
                    end,
                    text: String::new(),
                });
            }
            Event::End(TagEnd::Link) => {
                if let Some(l) = link.take() {
                    parsed.links.push(l);
                }
            }
            Event::Text(t) => {
                if let Some(l) = link.as_mut() {
                    l.text.push_str(&t);
                }
                let b = current.get_or_insert_with(|| open(Block::Paragraph));
                // Text equal to its source maps char by char; text that
                // isn't (an escape, an entity) maps every char to its start.
                let exact = markdown[range.clone()] == *t;
                for (k, c) in t.chars().enumerate() {
                    b.push(c, if exact { start + k } else { start });
                }
            }
            Event::Code(_)
            | Event::InlineMath(_)
            | Event::DisplayMath(_)
            | Event::InlineHtml(_)
            | Event::Html(_)
            | Event::FootnoteReference(_) => {
                if let Some(l) = link.as_mut() {
                    l.text.push(PLACEHOLDER);
                }
                if let Some(b) = current.as_mut() {
                    b.push(PLACEHOLDER, start);
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if let Some(b) = current.as_mut() {
                    b.push('\n', start);
                }
            }
            _ => {}
        }
    }
    close(&mut current, &mut parsed);
    parsed
}
