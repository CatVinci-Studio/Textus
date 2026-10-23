//! Exact counts for platform limits (the measure_text agent tool), because
//! models can't count characters. The limits are versioned facts from the
//! catalogue's platform table (craft#platforms, verified 2026-10-14):
//!
//! - X: 280 weighted - weight 1 for U+0000-U+10FF, U+2000-U+200D,
//!   U+2010-U+201F, U+2032-U+2037, 2 for everything else (CJK, kana,
//!   Hangul); every URL 23; each emoji (ZWJ sequences included) 2; NFC
//!   first (X docs; the weights from twitter-text's v3 config, facts only).
//! - Bluesky: 300 graphemes and 3,000 UTF-8 bytes (atproto lexicon).
//! - Threads 500; Instagram 2,200 and at most 5 hashtags; Mastodon 500 by
//!   default with links counted as 23 and mentions as their username;
//!   LinkedIn 3,000 with the "see more" fold near 140-210.
//! - WeChat 公众号 (API): title 32, digest 120, content under 20,000.
//! - 小红书 title 20 and body 1,000, 微博 2,000 folded at 140: unverified,
//!   warnings only.
//! - GOV.UK: title 65, summary 160 ending with a full stop.
//! - Chinese academic titles: 25 字 (GB/T 7713.2).

use super::text::{is_cjk, is_hangul};
use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;

/// The metrics measure_text knows, for its schema and error message.
pub const METRICS: &[&str] = &[
    "x_weighted",
    "bluesky",
    "threads",
    "instagram",
    "mastodon",
    "linkedin",
    "chars",
    "cjk_chars",
    "words",
    "utf8_bytes",
    "wechat_title",
    "wechat_digest",
    "wechat_content",
    "xhs_title",
    "xhs_body",
    "weibo",
    "govuk_title",
    "govuk_summary",
    "zh_academic_title",
];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Measure {
    pub metric: &'static str,
    pub count: usize,
    pub limit: Option<usize>,
    /// What is counted ("weighted characters", "graphemes", "字").
    pub unit: &'static str,
    pub within: bool,
    /// Counting rules and warnings worth saying.
    pub notes: Vec<String>,
}

static URL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?-u:\b)(?:https?://[^\s<>\x22]+|(?:[a-z0-9-]+\.)+(?:com|org|net|io|app|dev|ai|co|cn|jp|kr|de|fr|es|ru|br|pt|uk|us|me|info|edu|gov|tv|ly|xyz|tw|hk|so|gg|eu|ca|au|in)(?-u:\b)(?:/[^\s<>\x22]*)?)").unwrap()
});
static MENTION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(@[A-Za-z0-9_]+)@[A-Za-z0-9.-]+\.[A-Za-z]{2,}").unwrap());
static HASHTAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:^|\s)[#＃][\p{L}\p{N}_]+").unwrap());

fn is_emoji_grapheme(g: &str) -> bool {
    g.chars().any(|c| {
        matches!(c as u32, 0x1F000..=0x1FAFF | 0x2600..=0x27BF | 0x2B00..=0x2BFF | 0x231A..=0x231B | 0x23E9..=0x23FA)
            || c == '\u{FE0F}'
            || c == '\u{200D}'
    })
}

fn x_weight(c: char) -> usize {
    match c as u32 {
        0x0000..=0x10FF | 0x2000..=0x200D | 0x2010..=0x201F | 0x2032..=0x2037 => 1,
        _ => 2,
    }
}

/// X's weighted length.
pub fn x_weighted(text: &str) -> usize {
    let text: String = text.nfc().collect();
    let urls = URL.find_iter(&text).count();
    let rest = URL.replace_all(&text, "");
    let mut total = urls * 23;
    for g in rest.graphemes(true) {
        total += if is_emoji_grapheme(g) {
            2
        } else {
            g.chars().map(x_weight).sum()
        };
    }
    total
}

pub fn graphemes(text: &str) -> usize {
    text.graphemes(true).count()
}

/// Han, kana and Hangul characters.
pub fn cjk_chars(text: &str) -> usize {
    text.chars().filter(|&c| is_cjk(c) || is_hangul(c)).count()
}

/// Words: Latin, Cyrillic and Hangul words separated by spaces, plus each
/// Chinese or Japanese character on its own (how those languages count).
pub fn words(text: &str) -> usize {
    let mut n = 0;
    let mut in_word = false;
    for c in text.chars() {
        if is_cjk(c) {
            n += 1;
            in_word = false;
        } else if c.is_alphanumeric() || (in_word && matches!(c, '\'' | '’' | '-')) {
            if !in_word {
                n += 1;
            }
            in_word = true;
        } else {
            in_word = false;
        }
    }
    n
}

/// 字 as a Chinese title counts them: each CJK character, and each Latin
/// word or number as one.
fn zi(text: &str) -> usize {
    words(text)
}

fn mastodon(text: &str) -> usize {
    let urls = URL.find_iter(text).count();
    let rest = URL.replace_all(text, "");
    let rest = MENTION.replace_all(&rest, "$1");
    urls * 23 + graphemes(&rest)
}

/// Measures `text` by `metric`. None for an unknown metric.
pub fn measure(text: &str, metric: &str) -> Option<Measure> {
    let g = graphemes(text);
    let (metric, count, limit, unit, notes): (&'static str, usize, Option<usize>, &'static str, Vec<String>) = match metric {
        "x_weighted" => ("x_weighted", x_weighted(text), Some(280), "weighted characters", vec!["URLs count 23 each; CJK characters and emoji count 2.".into()]),
        "bluesky" => {
            let bytes = text.len();
            let mut notes = vec![format!("{bytes} of 3,000 UTF-8 bytes.")];
            if bytes > 3000 {
                notes.push("Over the byte limit.".into());
            }
            ("bluesky", g, Some(300), "graphemes", notes)
        }
        "threads" => ("threads", g, Some(500), "characters", vec![]),
        "instagram" => {
            let tags = HASHTAG.find_iter(text).count();
            let mut notes = vec![format!("{tags} hashtag(s); at most 5 per post since December 2025.")];
            if tags > 5 {
                notes.push("Too many hashtags.".into());
            }
            ("instagram", g, Some(2200), "characters", notes)
        }
        "mastodon" => ("mastodon", mastodon(text), Some(500), "characters", vec!["500 is the default; servers can set their own limit. Links count 23; a mention counts only its username.".into()]),
        "linkedin" => {
            let fold: String = text.chars().take(140).collect();
            ("linkedin", g, Some(3000), "characters", vec![format!("Readers see about the first 140 (mobile) to 210 (desktop) characters before “see more”: “{fold}”.")])
        }
        "chars" => ("chars", g, None, "characters", vec![]),
        "cjk_chars" => ("cjk_chars", cjk_chars(text), None, "CJK characters", vec![]),
        "words" => ("words", words(text), None, "words", vec!["Chinese and Japanese characters count one each.".into()]),
        "utf8_bytes" => ("utf8_bytes", text.len(), None, "bytes", vec![]),
        "wechat_title" => ("wechat_title", g, Some(32), "characters", vec![]),
        "wechat_digest" => ("wechat_digest", g, Some(120), "characters", vec!["An empty digest shows the first 54 characters of the article.".into()]),
        "wechat_content" => ("wechat_content", g, Some(19_999), "characters", vec!["Under 20,000 characters and under 1 MB.".into()]),
        "xhs_title" => ("xhs_title", g, Some(20), "characters", vec!["Unverified limit (third-party figure): a warning, not a rule.".into()]),
        "xhs_body" => ("xhs_body", g, Some(1000), "characters", vec!["Unverified limit (third-party figure): a warning, not a rule.".into()]),
        "weibo" => ("weibo", g, Some(2000), "characters", vec!["Folded after about 140 characters (2016 reports): a warning, not a rule.".into()]),
        "govuk_title" => ("govuk_title", g, Some(65), "characters", vec![]),
        "govuk_summary" => {
            let mut notes = Vec::new();
            if !text.trim_end().ends_with('.') {
                notes.push("A GOV.UK summary ends with a full stop.".into());
            }
            ("govuk_summary", g, Some(160), "characters", notes)
        }
        "zh_academic_title" => ("zh_academic_title", zi(text), Some(25), "字", vec!["Latin words and numbers count one each.".into()]),
        _ => return None,
    };
    let within = limit.is_none_or(|l| count <= l)
        && !(metric == "bluesky" && text.len() > 3000)
        && !(metric == "instagram" && HASHTAG.find_iter(text).count() > 5);
    Some(Measure {
        metric,
        count,
        limit,
        unit,
        within,
        notes,
    })
}

impl Measure {
    /// One line for the model: the count, the limit and the verdict.
    pub fn describe(&self) -> String {
        let mut line = match self.limit {
            Some(limit) if self.within => format!(
                "{}: {} of {limit} {} - within the limit ({} to spare).",
                self.metric,
                self.count,
                self.unit,
                limit - self.count.min(limit)
            ),
            Some(limit) => format!(
                "{}: {} of {limit} {} - OVER the limit by {}.",
                self.metric,
                self.count,
                self.unit,
                self.count.saturating_sub(limit).max(1)
            ),
            None => format!("{}: {} {}.", self.metric, self.count, self.unit),
        };
        for note in &self.notes {
            line.push(' ');
            line.push_str(note);
        }
        line
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn x_weights_cjk_urls_and_emoji() {
        assert_eq!(x_weighted("hello"), 5);
        assert_eq!(x_weighted("你好"), 4);
        assert_eq!(x_weighted("こんにちは"), 10);
        assert_eq!(x_weighted("안녕"), 4);
        // Any URL is 23, with or without a scheme.
        assert_eq!(
            x_weighted("see https://example.com/a/very/long/path?x=1"),
            4 + 23
        );
        assert_eq!(x_weighted("textus.app"), 23);
        // In Chinese text too, with no space around the address.
        assert_eq!(x_weighted("访问textus.app了解"), 4 + 23 + 4);
        // Abbreviations are not domains.
        assert_eq!(x_weighted("e.g. ok"), 7);
        // An emoji is 2, ZWJ family and flags included; curly quotes are 1.
        assert_eq!(x_weighted("👍"), 2);
        assert_eq!(x_weighted("👩\u{200D}👩\u{200D}👧"), 2);
        assert_eq!(x_weighted("🇯🇵"), 2);
        assert_eq!(x_weighted("“ok”"), 4);
        // NFC first: a decomposed é is one character.
        assert_eq!(x_weighted("e\u{301}"), 1);
    }

    #[test]
    fn bluesky_graphemes_and_bytes() {
        let m = measure("👩\u{200D}👩\u{200D}👧 hi", "bluesky").unwrap();
        assert_eq!(m.count, 4);
        assert!(m.within);
        let long = "字".repeat(1001); // 1001 graphemes, 3003 bytes
        let m = measure(&long, "bluesky").unwrap();
        assert!(!m.within);
        assert!(m.describe().contains("OVER"));
    }

    #[test]
    fn counts_for_other_platforms() {
        assert_eq!(cjk_chars("我用 React 写了 한글 と"), 7);
        assert_eq!(words("我用 React 写的 code-review tool"), 7);
        assert_eq!(
            measure("关于 AI 写作的研究", "zh_academic_title")
                .unwrap()
                .count,
            8
        );
        let m = measure("Apply for a passport", "govuk_summary").unwrap();
        assert!(m.notes.iter().any(|n| n.contains("full stop")));
        let m = measure("#a #b #c #d #e #f text", "instagram").unwrap();
        assert!(!m.within);
        assert_eq!(
            measure(
                "Hi @ann@mastodon.social see https://x.org/long/path",
                "mastodon"
            )
            .unwrap()
            .count,
            "Hi @ann see ".chars().count() + 23
        );
        assert!(measure("", "nonsense").is_none());
        for metric in METRICS {
            assert!(measure("text", metric).is_some(), "{metric}");
        }
        let m = measure("一二三四五六七八九十一二三四五六七八九十一", "xhs_title").unwrap();
        assert!(!m.within && m.describe().contains("Unverified"));
    }
}
