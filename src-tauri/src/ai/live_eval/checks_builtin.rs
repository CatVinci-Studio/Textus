//! Pure checks for the built-in skill suite: platform counts, Japanese and
//! Korean register, borrowing from a style sample, punctuation-only edits,
//! paired CJK marks, list items in a reply and where an edit landed.

use super::checks;

fn is_cjk(c: char) -> bool {
    matches!(c,
        '\u{4e00}'..='\u{9fff}' | '\u{3400}'..='\u{4dbf}' | '\u{f900}'..='\u{faff}'
        | '\u{3040}'..='\u{30ff}' | '\u{ac00}'..='\u{d7af}' | '\u{1100}'..='\u{11ff}')
}

/// Han, kana and hangul characters - how Chinese, Japanese and Korean
/// lengths are given ("300 字").
pub fn cjk_chars(text: &str) -> usize {
    text.chars().filter(|&c| is_cjk(c)).count()
}

// ------------------------------------------------------------------ measure

/// The counts `measure_text` gives the model, as far as the eval needs them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Metric {
    /// Unicode scalars of the trimmed text.
    Chars,
    /// Han, kana and hangul only.
    CjkChars,
    /// checks::word_count: CJK characters plus whitespace-separated words.
    Words,
    /// X's weighted length: 1 for Latin and general punctuation, 2 for everything
    /// else and for a whole emoji sequence, 23 for every URL.
    XWeighted,
}

impl Metric {
    pub fn name(self) -> &'static str {
        match self {
            Metric::Chars => "chars",
            Metric::CjkChars => "cjk_chars",
            Metric::Words => "words",
            Metric::XWeighted => "x_weighted",
        }
    }
}

pub fn measure(metric: Metric, text: &str) -> usize {
    let text = text.trim();
    match metric {
        Metric::Chars => text.chars().count(),
        Metric::CjkChars => cjk_chars(text),
        Metric::Words => checks::word_count(text),
        Metric::XWeighted => x_weighted(text),
    }
}

/// A token twitter-text would link: a scheme URL, or a bare domain with a
/// letter TLD (`textus.app`, `example.com/path`).
fn is_url(token: &str) -> bool {
    let t = token.trim_end_matches(|c: char| ".,;:!?)]}\"'”’".contains(c));
    if t.starts_with("http://") || t.starts_with("https://") {
        return true;
    }
    let host = t.split('/').next().unwrap_or("");
    if !host.is_ascii() || host.starts_with('.') || host.ends_with('.') {
        return false;
    }
    let labels: Vec<&str> = host.split('.').collect();
    labels.len() >= 2
        && labels
            .iter()
            .all(|l| !l.is_empty() && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
        && labels
            .last()
            .is_some_and(|tld| tld.len() >= 2 && tld.chars().all(|c| c.is_ascii_alphabetic()))
        && labels[0].chars().any(|c| c.is_ascii_alphabetic())
}

fn is_emoji(c: char) -> bool {
    matches!(c as u32, 0x1F000..=0x1FAFF | 0x2600..=0x27BF)
}

fn x_char_weight(c: char) -> usize {
    match c as u32 {
        0..=4351 | 8192..=8205 | 8208..=8223 | 8242..=8247 => 1,
        _ => 2,
    }
}

pub fn x_weighted(text: &str) -> usize {
    let mut total = 0;
    // Split on whitespace but keep it: spaces count too.
    let mut token = String::new();
    let flush = |token: &mut String, total: &mut usize| {
        if token.is_empty() {
            return;
        }
        if is_url(token) {
            let core = token.trim_end_matches(|c: char| ".,;:!?)]}\"'”’".contains(c));
            *total += 23 + weigh(&token[core.len()..]);
        } else {
            *total += weigh(token);
        }
        token.clear();
    };
    for c in text.chars() {
        if c.is_whitespace() {
            flush(&mut token, &mut total);
            total += x_char_weight(c);
        } else {
            token.push(c);
        }
    }
    flush(&mut token, &mut total);
    total
}

/// Weighs a run of non-space characters, an emoji sequence (modifiers,
/// ZWJ joins, variation selectors) counting 2 in all.
fn weigh(text: &str) -> usize {
    let mut total = 0;
    let mut in_emoji = false;
    let mut joined = false;
    for c in text.chars() {
        let cp = c as u32;
        if in_emoji && (cp == 0xFE0F || cp == 0x200D || (0x1F3FB..=0x1F3FF).contains(&cp) || joined)
        {
            joined = cp == 0x200D;
            continue;
        }
        if is_emoji(c) {
            total += 2;
            in_emoji = true;
            joined = false;
        } else {
            in_emoji = false;
            total += x_char_weight(c);
        }
    }
    total
}

/// Words starting with `#` that aren't Markdown headings (`#千岛湖`,
/// `#千岛湖#` and `#travel` each count once).
pub fn hashtags(text: &str) -> usize {
    text.lines()
        .filter(|l| !l.trim_start().starts_with("# ") && !l.trim_start().starts_with("##"))
        .map(|l| {
            let chars: Vec<char> = l.chars().collect();
            let mut n = 0;
            let mut i = 0;
            while i < chars.len() {
                if chars[i] == '#'
                    && chars
                        .get(i + 1)
                        .is_some_and(|c| !c.is_whitespace() && *c != '#')
                    && (i == 0 || chars[i - 1].is_whitespace() || chars[i - 1] == '#')
                {
                    n += 1;
                    // Skip the tag, and a closing # (小红书 style).
                    i += 1;
                    while i < chars.len() && !chars[i].is_whitespace() && chars[i] != '#' {
                        i += 1;
                    }
                }
                i += 1;
            }
            n
        })
        .sum()
}

// ----------------------------------------------------------------- register

/// The politeness level a Japanese or Korean sentence ends in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Register {
    /// です・ます調.
    JaPolite,
    /// である調 / だ調.
    JaPlain,
    /// 하십시오체 (-습니다, -ㅂ니까, -십시오).
    KoFormal,
    /// 해요체 (-요).
    KoPolite,
    /// 해라체 (-다).
    KoPlain,
}

/// Removes quoted speech, whose register is the speaker's.
fn without_quotes(text: &str) -> String {
    let mut out = String::new();
    let mut depth = 0usize;
    for c in text.chars() {
        match c {
            '「' | '『' | '“' => depth += 1,
            '」' | '』' | '”' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out
}

fn sentence_register(sentence: &str, ko: bool) -> Option<Register> {
    let s = sentence
        .trim()
        .trim_end_matches(['。', '.', '！', '？', '!', '?', '…', ' ']);
    if s.chars().count() < 3 || s == sentence.trim() {
        // Headings, list fragments, signatures: no final mark, no register.
        return None;
    }
    if ko {
        if ["니다", "니까", "십시오", "시오"]
            .iter()
            .any(|e| s.ends_with(e))
        {
            Some(Register::KoFormal)
        } else if s.ends_with('요') {
            Some(Register::KoPolite)
        } else if s.ends_with('다') || s.ends_with('나') || s.ends_with('자') {
            Some(Register::KoPlain)
        } else {
            None
        }
    } else if [
        "です",
        "ます",
        "でした",
        "ました",
        "ません",
        "でしょう",
        "ましょう",
        "ください",
        "ませんでした",
    ]
    .iter()
    .any(|e| s.ends_with(e))
    {
        Some(Register::JaPolite)
    } else if s
        .chars()
        .last()
        .is_some_and(|c| ('\u{3040}'..='\u{309f}').contains(&c) || is_cjk(c))
    {
        // Ends in a plain verb, adjective or copula (だ, である, した, ない,
        // する...) - or a noun (体言止め), which also reads as plain style.
        Some(Register::JaPlain)
    } else {
        None
    }
}

/// The register of every finished sentence of `text` (headings, list
/// fragments and quoted speech aside), for `ja` or `ko`.
pub fn registers(text: &str, lang: checks::Lang) -> Vec<Register> {
    let ko = lang == checks::Lang::Ko;
    checks::sentences(&without_quotes(text))
        .iter()
        .filter_map(|s| sentence_register(s, ko))
        .collect()
}

/// Ok(Some(register)) when every finished sentence is in one register,
/// Ok(None) when none says; Err naming the mix otherwise.
pub fn register_of(text: &str, lang: checks::Lang) -> Result<Option<Register>, String> {
    let found = registers(text, lang);
    let first = found.first().copied();
    let mixed: Vec<Register> = found
        .iter()
        .copied()
        .filter(|r| Some(*r) != first)
        .collect();
    if mixed.is_empty() {
        Ok(first)
    } else {
        let count = |r: Register| found.iter().filter(|x| **x == r).count();
        let mut kinds: Vec<Register> = found.clone();
        kinds.dedup();
        kinds.sort_by_key(|r| *r as u8);
        kinds.dedup();
        Err(format!(
            "mixed registers: {}",
            kinds
                .iter()
                .map(|r| format!("{r:?} x{}", count(*r)))
                .collect::<Vec<_>>()
                .join(", ")
        ))
    }
}

// ------------------------------------------------------------------ overlap

fn overlap_tokens(text: &str, cjk: bool) -> Vec<String> {
    if cjk {
        text.chars()
            .filter(|c| c.is_alphanumeric())
            .map(|c| c.to_string())
            .collect()
    } else {
        text.to_lowercase()
            .split(|c: char| !c.is_alphanumeric() && c != '\'')
            .filter(|w| !w.is_empty())
            .map(str::to_string)
            .collect()
    }
}

/// Err with the first run of `n` tokens (characters for CJK samples,
/// words otherwise; punctuation and spacing ignored) that `text` takes
/// from `sample` - imitation should borrow traits, not sentences.
pub fn max_overlap(sample: &str, text: &str, n: usize) -> Result<(), String> {
    let cjk = cjk_chars(sample) * 2 > sample.chars().filter(|c| c.is_alphanumeric()).count();
    let a = overlap_tokens(sample, cjk);
    let b = overlap_tokens(text, cjk);
    if n == 0 || a.len() < n || b.len() < n {
        return Ok(());
    }
    let grams: std::collections::HashSet<&[String]> = a.windows(n).collect();
    match b.windows(n).find(|w| grams.contains(w)) {
        None => Ok(()),
        Some(w) => Err(format!(
            "copies {:?} from the sample",
            w.join(if cjk { "" } else { " " })
        )),
    }
}

// ------------------------------------------------------------- punctuation

/// Ok when `after` differs from `before` only in punctuation, symbols and
/// spacing (a "only fix the punctuation" request); Err shows where the
/// words changed.
pub fn changed_chars_only_punct(before: &str, after: &str) -> Result<(), String> {
    let letters = |s: &str| -> Vec<char> { s.chars().filter(|c| c.is_alphanumeric()).collect() };
    let (a, b) = (letters(before), letters(after));
    if a == b {
        return Ok(());
    }
    let at = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let show = |v: &[char]| {
        v[at.min(v.len())..(at + 12).min(v.len())]
            .iter()
            .collect::<String>()
    };
    Err(format!("wording changed: {:?} -> {:?}", show(&a), show(&b)))
}

/// Runs of `mark` (…, ―, —) that aren't doubled: CJK ellipses and dashes
/// come in pairs (…… and ――).
pub fn unpaired(text: &str, mark: char) -> Vec<usize> {
    let mut lone = Vec::new();
    let mut run = 0;
    for c in text.chars().chain(std::iter::once('\0')) {
        if c == mark {
            run += 1;
        } else {
            if run % 2 == 1 {
                lone.push(run);
            }
            run = 0;
        }
    }
    lone
}

/// Character-level Levenshtein distance over `before` and `after` as a
/// share of `before`'s length - how much of the text an edit rewrote.
pub fn changed_share(before: &str, after: &str) -> f64 {
    let a: Vec<char> = before.chars().collect();
    let b: Vec<char> = after.chars().collect();
    if a.is_empty() {
        return if b.is_empty() { 0.0 } else { 1.0 };
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for i in 1..=a.len() {
        cur[0] = i;
        for j in 1..=b.len() {
            let sub = prev[j - 1] + usize::from(a[i - 1] != b[j - 1]);
            cur[j] = sub.min(prev[j] + 1).min(cur[j - 1] + 1);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()] as f64 / a.len() as f64
}

// ------------------------------------------------------------- structure

/// List items at the top level of `text` (bullets or numbers at the start
/// of a line, not indented) - options offered in a reply.
pub fn top_level_items(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|l| {
            if l.starts_with(char::is_whitespace) {
                return None;
            }
            for marker in ["* ", "- ", "+ ", "• "] {
                if let Some(rest) = l.strip_prefix(marker) {
                    return Some(rest.trim().to_string());
                }
            }
            let digits = l.chars().take_while(|c| c.is_ascii_digit()).count();
            if digits > 0 {
                let rest = &l[digits..];
                for sep in [". ", ") ", "、", "．"] {
                    if let Some(item) = rest.strip_prefix(sep) {
                        return Some(item.trim().to_string());
                    }
                }
            }
            None
        })
        .collect()
}

/// A list item or title without its decoration: bold, quotes and the
/// trailing space, so its length and final mark can be checked.
pub fn bare(item: &str) -> String {
    let t = item.trim().trim_matches(|c| c == '*' || c == '_').trim();
    let t = t
        .strip_prefix(['"', '“', '「', '\''])
        .and_then(|s| s.strip_suffix(['"', '”', '」', '\'']))
        .unwrap_or(t);
    t.trim().to_string()
}

/// The text of the first ATX heading in `markdown`.
pub fn first_heading(markdown: &str) -> Option<String> {
    markdown.lines().find_map(|l| {
        let hashes = l.chars().take_while(|&c| c == '#').count();
        ((1..=6).contains(&hashes) && l[hashes..].starts_with(' '))
            .then(|| l[hashes..].trim().to_string())
    })
}

/// Markdown task-list items (`* [ ]`, `- [ ]`, checked or not).
pub fn task_items(markdown: &str) -> usize {
    markdown
        .lines()
        .filter(|l| {
            let t = l.trim_start();
            ["* [ ]", "- [ ]", "* [x]", "- [x]"]
                .iter()
                .any(|m| t.starts_with(m))
        })
        .count()
}

/// The text without heading lines - a post or abstract that came with a
/// title.
pub fn body_without_headings(markdown: &str) -> String {
    markdown
        .lines()
        .filter(|l| first_heading(l).is_none())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

/// Ok when the edit between `before` and `after` lies inside the stretch
/// of `before` from the start of `from` to the end of `to` (both must
/// occur in it) - "insert after paragraph 1" lands between them.
pub fn span_within(before: &str, after: &str, from: &str, to: &str) -> Result<(), String> {
    if before == after {
        return Ok(());
    }
    let start = before
        .find(from)
        .ok_or_else(|| "case error: start anchor not in document".to_string())?;
    let end = before[start..]
        .find(to)
        .map(|i| start + i + to.len())
        .ok_or_else(|| "case error: end anchor not in document".to_string())?;
    let (s, e, _) = checks::changed_span(before, after);
    if s >= start && e <= end {
        Ok(())
    } else {
        Err(format!(
            "changed bytes {s}-{e}, outside the target {start}-{end}"
        ))
    }
}

/// The whole blank-line-separated blocks of `text` around the byte span
/// `s..e`, ignoring newlines at the span's edges (an inserted paragraph
/// arrives with its separator attached).
pub fn block_around(text: &str, s: usize, e: usize) -> &str {
    let inner = &text[s..e];
    let (s, e) = if inner.trim_matches('\n').is_empty() {
        (s, s)
    } else {
        let lead = inner.len() - inner.trim_start_matches('\n').len();
        (s + lead, s + inner.trim_end_matches('\n').len())
    };
    let start = text[..s].rfind("\n\n").map_or(0, |i| i + 2);
    let end = text[e..].find("\n\n").map_or(text.len(), |i| e + i);
    text[start..end.max(start)].trim()
}

/// The blocks an edit touched, before and after - whole paragraphs, not
/// the fragment a diff happens to start in. Both empty when nothing
/// changed.
pub fn changed_blocks(before: &str, after: &str) -> (String, String) {
    if before == after {
        return (String::new(), String::new());
    }
    let (s, e, e2) = checks::changed_span(before, after);
    (
        block_around(before, s, e).to_string(),
        block_around(after, s, e2).to_string(),
    )
}

/// Speech tags glued to an unpunctuated quote: `"I'm going" she said`,
/// `ten" she replied` - the comma is missing.
pub fn missing_tag_commas(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for close in ['"', '”'] {
        for (i, _) in text.match_indices(close) {
            let before = text[..i].chars().next_back();
            let after = &text[i + close.len_utf8()..];
            let tagged = [" she ", " he ", " they ", " I "]
                .iter()
                .any(|p| after.starts_with(p))
                && ["said", "asked", "replied"].iter().any(|v| {
                    after
                        .split_whitespace()
                        .nth(1)
                        .is_some_and(|w| w.trim_matches(|c: char| !c.is_alphabetic()) == *v)
                });
            if tagged && before.is_some_and(char::is_alphanumeric) {
                let start = text[..i].char_indices().rev().nth(12).map_or(0, |(k, _)| k);
                let end = text[i..]
                    .char_indices()
                    .nth(12)
                    .map_or(text.len(), |(k, _)| i + k);
                out.push(text[start..end].to_string());
            }
        }
    }
    out
}

/// `said angrily`, `asked quietly`: an adverb right after a speech verb.
pub fn adverb_tags(text: &str) -> Vec<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    words
        .windows(2)
        .filter(|w| {
            let verb = w[0]
                .trim_matches(|c: char| !c.is_alphabetic())
                .to_lowercase();
            let adv = w[1].trim_matches(|c: char| !c.is_alphabetic());
            ["said", "asked", "replied"].contains(&verb.as_str())
                && adv.len() > 4
                && adv.ends_with("ly")
                && !["only", "early", "family", "holy"].contains(&adv)
        })
        .map(|w| format!("{} {}", w[0], w[1]))
        .collect()
}

/// Mean clause length in CJK characters, clauses split at Chinese and
/// Japanese punctuation - how a "short, plain sentences" style shows.
pub fn mean_clause_cjk(text: &str) -> f64 {
    let clauses: Vec<usize> = text
        .split(|c: char| "，。；！？、：,;!?\n".contains(c))
        .map(cjk_chars)
        .filter(|&n| n > 0)
        .collect();
    if clauses.is_empty() {
        return 0.0;
    }
    clauses.iter().sum::<usize>() as f64 / clauses.len() as f64
}

#[cfg(test)]
mod tests {
    use super::*;
    use checks::Lang;

    #[test]
    fn x_counts_cjk_double_and_urls_as_23() {
        assert_eq!(x_weighted("hello world"), 11);
        assert_eq!(x_weighted("你好"), 4);
        assert_eq!(x_weighted("see textus.app"), 4 + 23);
        assert_eq!(x_weighted("see https://textus.app/download."), 4 + 23 + 1);
        // 2,000 and 1.0 are not links.
        assert_eq!(x_weighted("2,000 testers, v1.0"), 19);
        // One emoji, a skin tone, a ZWJ family: 2 each.
        assert_eq!(x_weighted("🎉"), 2);
        assert_eq!(x_weighted("👍🏽"), 2);
        assert_eq!(x_weighted("👨\u{200d}👩\u{200d}👧"), 2);
        assert_eq!(x_weighted("a 🎉 b"), 6);
        // General punctuation (curly quotes, em dash) weighs 1.
        assert_eq!(x_weighted("“a”—b"), 5);
        assert_eq!(measure(Metric::Chars, "  标题 ok "), 5);
        assert_eq!(measure(Metric::CjkChars, "标题 ok"), 2);
        assert_eq!(measure(Metric::Words, "标题 ok go"), 4);
    }

    #[test]
    fn urls_need_a_letter_tld_and_a_name() {
        assert!(is_url("textus.app"));
        assert!(is_url("example.com/path),"));
        assert!(!is_url("e.g."));
        assert!(!is_url("1.0"));
        assert!(!is_url("3.5kg"));
        assert!(!is_url("中文.com"));
    }

    #[test]
    fn hashtags_count_once_and_skip_headings() {
        assert_eq!(hashtags("# 标题\n正文 #千岛湖 #旅行#\n#秋天"), 3);
        assert_eq!(hashtags("## Heading\nno tags # here"), 0);
        assert_eq!(hashtags("#a #b"), 2);
    }

    #[test]
    fn japanese_register_is_read_from_sentence_ends() {
        let polite = "図書館は1月に始めました。毎月アンケートを配布しています。";
        assert_eq!(register_of(polite, Lang::Ja), Ok(Some(Register::JaPolite)));
        let plain = "図書館は1月に始めた。毎月アンケートを配布している。参加者は増加傾向である。";
        assert_eq!(register_of(plain, Lang::Ja), Ok(Some(Register::JaPlain)));
        let mixed = "図書館は1月に始めました。参加者は増えた。";
        assert!(register_of(mixed, Lang::Ja)
            .unwrap_err()
            .contains("JaPolite x1"));
        // Headings and quoted speech don't count.
        let doc = "# 方法\n\n彼は「行くよ。」と言いました。結果を報告します。";
        assert_eq!(register_of(doc, Lang::Ja), Ok(Some(Register::JaPolite)));
        assert_eq!(register_of("# 方法", Lang::Ja), Ok(None));
    }

    #[test]
    fn korean_register_tells_the_three_styles_apart() {
        let formal = "회의를 목요일로 옮겨도 되겠습니까? 자료는 수요일까지 보내 드리겠습니다.\n\n박민수 드림";
        assert_eq!(register_of(formal, Lang::Ko), Ok(Some(Register::KoFormal)));
        let haeyo = "회의를 옮겨도 될까요? 자료는 보내 드릴게요.";
        assert_eq!(register_of(haeyo, Lang::Ko), Ok(Some(Register::KoPolite)));
        let mixed = "회의를 옮겨도 되겠습니까? 자료는 보내 드릴게요.";
        assert!(register_of(mixed, Lang::Ko).is_err());
        let plain = "회의를 옮겼다. 자료는 보냈다.";
        assert_eq!(register_of(plain, Lang::Ko), Ok(Some(Register::KoPlain)));
    }

    #[test]
    fn overlap_finds_borrowed_runs() {
        let sample = "雨停了。街上很静。你走过去，推开门。灯是黄的。";
        assert!(max_overlap(sample, "风停了。屋里很暗。", 6).is_ok());
        let err = max_overlap(sample, "他走过去，推开门。灯是黄的。", 6).unwrap_err();
        assert!(err.contains("走过去推开门"), "{err}");
        let en = "You wake before the alarm. The flat is cold and the street is still dark.";
        assert!(max_overlap(en, "You wake early. The office is warm.", 5).is_ok());
        assert!(max_overlap(en, "Now the flat is cold and the street is quiet.", 5).is_err());
        assert!(max_overlap(en, "short", 5).is_ok());
    }

    #[test]
    fn punctuation_only_edits_pass_and_rewording_fails() {
        let before = "林晚把伞收起来,问:\"车什么时候到?\"";
        let after = "林晚把伞收起来，问：“车什么时候到？”";
        assert!(changed_chars_only_punct(before, after).is_ok());
        let reworded = "林晚收起伞，问：“车几点到？”";
        assert!(changed_chars_only_punct(before, reworded).is_err());
    }

    #[test]
    fn cjk_marks_must_be_paired() {
        assert!(unpaired("「ごめん……」――そう", '…').is_empty());
        assert!(unpaired("「ごめん……」――そう", '―').is_empty());
        assert_eq!(unpaired("待って…", '…'), vec![1]);
        assert_eq!(unpaired("a―b――c", '―'), vec![1]);
    }

    #[test]
    fn changed_share_is_edit_distance_over_length() {
        assert_eq!(changed_share("abcd", "abcd"), 0.0);
        assert!((changed_share("abcd", "abxd") - 0.25).abs() < 1e-9);
        assert!((changed_share("the the cat", "the cat") - 4.0 / 11.0).abs() < 1e-9);
    }

    #[test]
    fn reply_items_and_headings() {
        let reply =
            "Here are options:\n\n1. First one\n2. **Second**\n   * nested\n- Third\n\nDone.";
        assert_eq!(
            top_level_items(reply),
            vec!["First one", "**Second**", "Third"]
        );
        assert_eq!(top_level_items("一、不算\n1、算"), vec!["算"]);
        assert_eq!(bare("**\"A title\"**"), "A title");
        assert_eq!(bare("「标题」"), "标题");
        assert_eq!(first_heading("text\n## Two\n# One").as_deref(), Some("Two"));
        assert_eq!(first_heading("#hashtag"), None);
        assert_eq!(task_items("* [ ] a\n* [x] b\n* c\n  - [ ] d"), 3);
        assert_eq!(
            body_without_headings("# T\n\nbody\n## S\nmore"),
            "body\nmore"
        );
    }

    #[test]
    fn spans_are_checked_against_two_anchors() {
        let before = "# T\n\nOne.\n\nTwo.\n\nThree.";
        let after = "# T\n\nOne.\n\nNew.\n\nTwo.\n\nThree.";
        assert!(span_within(before, after, "One.", "Two.").is_ok());
        assert!(span_within(before, after, "Three.", "Three.").is_err());
        let after = "# T\n\nOne.\n\nTwo.\n\nThree, changed.";
        assert!(span_within(before, after, "One.", "Two.").is_err());
        assert!(span_within(before, before, "x", "y").is_ok());
    }

    #[test]
    fn changed_blocks_are_whole_paragraphs() {
        let before = "# T\n\nOne two.\n\nThree.";
        let (a, b) = changed_blocks(before, "# T\n\nOne too.\n\nThree.");
        assert_eq!((a.as_str(), b.as_str()), ("One two.", "One too."));
        let (a, b) = changed_blocks(before, "# T\n\nOne two.\n\nNew.\n\nThree.");
        assert_eq!(b, "New.");
        assert!(a.is_empty() || a == "One two." || a == "Three.", "{a:?}");
        assert_eq!(
            changed_blocks(before, before),
            (String::new(), String::new())
        );
    }

    #[test]
    fn dialogue_tag_helpers() {
        let bad = "\"I'm going\" she said angrily.\n\n\"Out. I'll be back by ten\" she replied.";
        assert_eq!(missing_tag_commas(bad).len(), 2);
        let good = "\"I'm going,\" she said.\n\n\"Where?\" he asked.";
        assert!(missing_tag_commas(good).is_empty());
        assert_eq!(adverb_tags(bad), vec!["said angrily."]);
        assert!(adverb_tags("she said only that").is_empty());
    }

    #[test]
    fn simplified_only_characters_are_found_once() {
        assert_eq!(
            checks::simplified_only("参与者们说这个问卷"),
            vec!['与', '们', '说', '这', '个', '问']
        );
        assert!(checks::simplified_only("參與者們說這個問卷").is_empty());
        // Forms that are ordinary Traditional too, and identical pairs.
        assert_eq!(checks::simplified_only("五公里以后报告"), vec!['报']);
    }

    #[test]
    fn clause_length_and_cjk_counts() {
        assert_eq!(cjk_chars("雨停了 ok 。"), 3);
        assert!((mean_clause_cjk("雨停了。街上很静。") - 3.5).abs() < 1e-9);
        assert_eq!(mean_clause_cjk("no cjk"), 0.0);
    }
}
