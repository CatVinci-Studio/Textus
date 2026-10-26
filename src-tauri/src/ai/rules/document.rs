//! Whole-document checks: the Markdown parsed into blocks of prose (code, math,
//! front matter, HTML never reach a rule), each in its own language, plus the
//! rules only a document has: headings, image alt text, link text, 公文.

use super::detect::{self, Lang};
use super::messages;
use super::profile::{Conventions, Profile};
use super::registry::{DOC, GC};
use super::text::{Text, PLACEHOLDER};
use super::{finish, run_rules, Block, Ctx, Finding, Fix, Level, Out, Stats};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde::Serialize;
use std::collections::BTreeMap;

/// One block of prose and where each of its chars came from.
struct BlockText {
    kind: Block,
    text: String,
    /// Char index in `text` -> char offset in the source.
    map: Vec<usize>,
}

impl BlockText {
    fn push(&mut self, c: char, at: usize) {
        self.text.push(c);
        self.map.push(at);
    }
}

struct Image {
    start: usize,
    end: usize,
    alt: String,
}

struct Link {
    start: usize,
    end: usize,
    text: String,
}

/// The parsed document.
struct Parsed {
    blocks: Vec<BlockText>,
    images: Vec<Image>,
    links: Vec<Link>,
    /// (level, block index) for each heading.
    headings: Vec<(u8, usize)>,
}

fn parse(markdown: &str) -> Parsed {
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

/// Which script family a text is written in, by its letters.
fn script_family(text: &str) -> Option<u8> {
    let (mut cjk, mut hangul, mut cyr, mut latin) = (0, 0, 0, 0);
    for c in text.chars() {
        if super::text::is_cjk(c) {
            cjk += 1;
        } else if super::text::is_hangul(c) {
            hangul += 1;
        } else if super::text::is_cyrillic(c) {
            cyr += 1;
        } else if super::text::is_latin_letter(c) {
            latin += 1;
        }
    }
    // CJK characters carry about a word each, Latin letters a fifth.
    let scores = [(0u8, cjk * 5), (1, hangul * 3), (2, cyr), (3, latin)];
    let (family, score) = scores.into_iter().max_by_key(|x| x.1)?;
    (score > 0).then_some(family)
}

/// A block's language: its own when it says so clearly, else the document's.
/// A short block in the document's script is the document's language (a
/// Japanese heading of kanji isn't Chinese).
fn block_language(text: &str, doc_lang: Option<Lang>) -> Option<Lang> {
    let letters = text.chars().filter(|c| c.is_alphabetic()).count();
    let own = detect::detect(text);
    let Some(doc) = doc_lang else {
        return own.or_else(|| detect::guess(text));
    };
    let cjk_family = |l: Lang| matches!(l, Lang::ZhHans | Lang::ZhHant | Lang::Ja);
    match own {
        Some(l) if l == doc => Some(l),
        // Chinese and Japanese share ideographs: a block the detector calls
        // Chinese in a Japanese document (or the other script in a Chinese
        // one) is the document's language.
        Some(l) if cjk_family(l) && cjk_family(doc) && (l.is_chinese() || doc == Lang::Ja) => {
            Some(doc)
        }
        Some(l) if letters >= 40 || script_family(text) != script_family(&doc_sample(doc)) => {
            Some(l)
        }
        Some(_) => Some(doc),
        None => match script_family(text) {
            Some(f) if Some(f) != script_family(&doc_sample(doc)) => detect::guess(text),
            _ => Some(doc),
        },
    }
}

/// A word in the language's script, for comparing script families.
fn doc_sample(lang: Lang) -> String {
    match lang {
        Lang::ZhHans | Lang::ZhHant | Lang::Ja => "中",
        Lang::Ko => "한",
        Lang::Ru => "я",
        _ => "a",
    }
    .to_string()
}

/// What check_document found, and under which conventions.
#[derive(Serialize, Clone, Debug)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DocReport {
    /// The document's language (None: too little prose to tell).
    pub lang: Option<Lang>,
    pub profile: Option<Profile>,
    pub findings: Vec<Finding>,
}

/// Checks a whole Markdown document: every block in its own language, with the
/// whole document's convention counts. Offsets are chars into `markdown`. A
/// suggestion whose span crosses Markdown syntax is dropped, the flag kept.
pub fn check_document(
    markdown: &str,
    conv: &Conventions,
    level: Level,
    library: &[String],
) -> DocReport {
    check_document_with(markdown, None, conv, level, library)
}

/// [`check_document`], with `context` (the rest of the document, the text
/// before a cursor) counted into the convention majority but not checked.
pub(crate) fn check_document_with(
    markdown: &str,
    context: Option<&str>,
    conv: &Conventions,
    level: Level,
    library: &[String],
) -> DocReport {
    let parsed = parse(markdown);
    let prose: String = parsed
        .blocks
        .iter()
        .map(|b| b.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let doc_lang = detect::detect(&prose).or_else(|| detect::guess(&prose));
    let block_langs: Vec<Option<Lang>> = parsed
        .blocks
        .iter()
        .map(|b| block_language(&b.text, doc_lang))
        .collect();
    let texts: Vec<Text> = parsed.blocks.iter().map(|b| Text::new(&b.text)).collect();
    let mut stats: BTreeMap<Lang, Stats> = BTreeMap::new();
    for (t, lang) in texts.iter().zip(&block_langs) {
        if let Some(lang) = lang {
            stats.entry(*lang).or_default().count(t, *lang);
        }
    }
    if let Some(ctx_text) = context {
        let ctx_parsed = parse(ctx_text);
        for b in &ctx_parsed.blocks {
            let lang = detect::detect(&b.text).or(doc_lang);
            if let Some(lang) = lang {
                stats
                    .entry(lang)
                    .or_default()
                    .count(&Text::new(&b.text), lang);
            }
        }
    }
    let src: Vec<char> = markdown.chars().collect();
    let mut found: Vec<Finding> = Vec::new();
    let empty = Stats::default();
    for (i, (t, lang)) in texts.iter().zip(&block_langs).enumerate() {
        let Some(lang) = *lang else { continue };
        let profile = conv.profile_for(lang);
        let ctx = Ctx {
            lang,
            messages: lang,
            profile: &profile,
            stats: stats.get(&lang).unwrap_or(&empty),
            block: parsed.blocks[i].kind,
            library,
        };
        let mut out = Out::new(t);
        run_rules(t, &ctx, &mut out);
        let map = &parsed.blocks[i].map;
        for mut f in out.found {
            let (s, e) = (map[f.start], map[f.end - 1] + 1);
            let source: String = src[s.min(src.len())..e.min(src.len())].iter().collect();
            if source != f.original {
                // A space beside Markdown syntax (`**粗体** 和`) is how
                // CJK emphasis is made to parse, not a spacing choice.
                if f.info().category == super::registry::Category::Spacing {
                    continue;
                }
                f.suggestion = None;
                f.fix = Fix::None;
            }
            f.start = s;
            f.end = e;
            f.original = source;
            found.push(f);
        }
    }
    let doc_profile = doc_lang.map(|l| conv.profile_for(l));
    if let Some(lang) = doc_lang {
        document_rules(
            &parsed,
            &src,
            lang,
            doc_profile.as_ref().unwrap(),
            &mut found,
        );
    }
    let mut findings = finish(found, level, GC | DOC, true);
    for f in &mut findings {
        f.line = Some(
            src[..f.start.min(src.len())]
                .iter()
                .filter(|&&c| c == '\n')
                .count()
                + 1,
        );
    }
    DocReport {
        lang: doc_lang,
        profile: doc_profile,
        findings,
    }
}

fn finding(rule: &'static str, src: &[char], start: usize, end: usize, message: String) -> Finding {
    let info = super::registry::info(rule);
    Finding {
        rule,
        start,
        end,
        original: src[start.min(src.len())..end.min(src.len())]
            .iter()
            .collect(),
        suggestion: None,
        severity: info.severity,
        fix: Fix::None,
        priority: info.priority,
        message,
        line: None,
    }
}

/// Rules that need the whole document.
fn document_rules(
    parsed: &Parsed,
    src: &[char],
    lang: Lang,
    profile: &Profile,
    found: &mut Vec<Finding>,
) {
    let span = |i: usize| {
        let map = &parsed.blocks[i].map;
        (map[0], map[map.len() - 1] + 1)
    };
    // Heading structure: skipped levels, more than three levels.
    let mut prev: Option<u8> = None;
    let mut deep_reported = false;
    for &(level, i) in &parsed.headings {
        let (s, e) = span(i);
        if let Some(p) = prev {
            if level > p + 1 {
                found.push(finding(
                    "shared.heading-structure",
                    src,
                    s,
                    e,
                    messages::get(
                        "shared.heading-structure.skip",
                        lang,
                        &[&level.to_string(), &p.to_string()],
                    ),
                ));
            }
        }
        if level > 3 && !deep_reported {
            found.push(finding(
                "shared.heading-structure",
                src,
                s,
                e,
                messages::get("shared.heading-structure.depth", lang, &[]),
            ));
            deep_reported = true;
        }
        prev = Some(level);
    }
    // Image alt text.
    for img in &parsed.images {
        let alt = img.alt.trim();
        let key = if alt.is_empty() {
            Some("shared.image-alt.empty")
        } else if alt.chars().count() > 155 {
            Some("shared.image-alt.long")
        } else if lang == Lang::En
            && (alt.to_lowercase().starts_with("image of")
                || alt.to_lowercase().starts_with("picture of"))
        {
            Some("shared.image-alt.redundant")
        } else {
            None
        };
        if let Some(key) = key {
            found.push(finding(
                "shared.image-alt",
                src,
                img.start,
                img.end,
                messages::get(key, lang, &[]),
            ));
        }
    }
    // Link text that says nothing about where it goes.
    if lang == Lang::En {
        for l in &parsed.links {
            let text = l.text.trim().to_lowercase();
            if [
                "click here",
                "here",
                "read more",
                "this link",
                "more",
                "link",
                "click",
            ]
            .contains(&text.as_str())
            {
                found.push(finding(
                    "en.link.text",
                    src,
                    l.start,
                    l.end,
                    "Link text should say where the link goes, not “click here”.".to_string(),
                ));
            }
        }
    }
    // 公文: a document titled 报告 must not ask for approval.
    if profile.is("gongwen") && profile.mainland() {
        let title = parsed
            .headings
            .first()
            .map(|&(_, i)| parsed.blocks[i].text.clone())
            .or_else(|| parsed.blocks.first().map(|b| b.text.clone()))
            .unwrap_or_default();
        if title.contains("报告") && !title.contains("请示") {
            for b in &parsed.blocks {
                for ask in ["请批准", "请批示", "请审批"] {
                    for (k, _) in b.text.match_indices(ask) {
                        let a = b.text[..k].chars().count();
                        let n = ask.chars().count();
                        found.push(finding(
                            "zh.gongwen.report-request",
                            src,
                            b.map[a],
                            b.map[a + n - 1] + 1,
                            "报告中不得夹带请示事项：需要批准的事项请另行请示。".to_string(),
                        ));
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
