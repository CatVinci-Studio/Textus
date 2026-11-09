//! Whole-document checks: the Markdown parsed into blocks of prose (code, math,
//! front matter, HTML never reach a rule), each in its own language, plus the
//! rules only a document has: headings, image alt text, link text, 公文.

use super::detect::{self, Lang};
use super::messages;
use super::profile::{Conventions, Profile};
use super::registry::{DOC, GC};
use super::text::Text;
use super::{finish, run_rules, Ctx, Finding, Fix, Level, Out, Stats};
use serde::Serialize;
use std::collections::BTreeMap;

mod parse;
use parse::{parse, Parsed};

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
