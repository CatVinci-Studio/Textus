//! The grammar matrix: each strictness level on real mistakes, on clean text,
//! and on text with code, URLs, math and names to leave alone. The paragraph is
//! the block's textContent, as the editor sends it.

use super::checks::{self, Lang};
use super::harness::{self, Checks, Record};
use crate::ai::client::{finish_grammar, grammar_instructions, grammar_user_text, GrammarIssue};
use aicompat::providers::anthropic::AnthropicAuth;
use serde_json::json;

pub struct GrammarCase {
    pub id: &'static str,
    pub lang: Lang,
    pub strictness: &'static str,
    pub paragraph: &'static str,
    /// (the wrong text, what the corrected paragraph must then contain).
    pub fixes: &'static [(&'static str, &'static str)],
    /// Spans no issue may touch.
    pub protected: &'static [&'static str],
    /// Most issues allowed beyond `fixes` (0 = no false positives at all).
    pub extra: usize,
    /// The paragraph's Markdown when it carries inline formatting: the check gets
    /// its textContent, and every fix must keep the formatting when written back.
    pub markdown: Option<&'static str>,
}

/// The defaults the cases fill in with `..G`.
pub const G: GrammarCase = GrammarCase {
    id: "",
    lang: Lang::En,
    strictness: "standard",
    paragraph: "",
    fixes: &[],
    protected: &[],
    extra: 0,
    markdown: None,
};

impl GrammarCase {
    /// What the editor sends: the block's textContent.
    pub fn text(&self) -> String {
        match self.markdown {
            Some(md) => checks::inline_text(md).text,
            None => self.paragraph.to_string(),
        }
    }
}

/// A fix expectation may list alternatives: "late. We|late; we". Each carries
/// enough context to fail on a fix that leaves the wrong word standing.
fn fix_ok(corrected: &str, fix: &str) -> bool {
    fix.split('|').any(|f| corrected.contains(f))
}

pub const CASES: &[GrammarCase] = &[
    GrammarCase { id: "en/typos/standard", lang: Lang::En, strictness: "standard", paragraph: "The commitee will recieve the final report on Friday, and then it will decide wether to fund the second phase.", fixes: &[("commitee", "committee"), ("recieve", "receive"), ("wether", "whether")], protected: &[], extra: 0, ..G },
    GrammarCase { id: "en/grammar/standard", lang: Lang::En, strictness: "standard", paragraph: "Each of the participants have their own reasons for joining, and the results of the survey was surprising to all of us.", fixes: &[("have", "has"), ("was", "were")], protected: &[], extra: 0, ..G },
    GrammarCase { id: "en/clean/standard", lang: Lang::En, strictness: "standard", paragraph: "The library opened a second reading room in March. Since then, weekday attendance has nearly doubled, and the waiting list for study desks has disappeared.", fixes: &[], protected: &[], extra: 0, ..G },
    GrammarCase { id: "en/clean/typos", lang: Lang::En, strictness: "typos", paragraph: "We shipped the release on Tuesday. Nobody noticed the new icon, which is probably the best compliment a redesign can get.", fixes: &[], protected: &[], extra: 0, ..G },
    GrammarCase { id: "en/clean/strict", lang: Lang::En, strictness: "strict", paragraph: "The library opened a second reading room in March. Since then, weekday attendance has nearly doubled, and the waiting list for study desks has disappeared.", fixes: &[], protected: &[], extra: 1, ..G },
    GrammarCase { id: "en/code-url-math/standard", lang: Lang::En, strictness: "standard", paragraph: "Run npm install, then open http://localhost:1430/docs to check that the the value of x^2 + y^2 is shown; the tsconfig.json file controls this.", fixes: &[("the the", "check that the value")], protected: &["npm install", "http://localhost:1430/docs", "x^2 + y^2", "tsconfig.json"], extra: 0, ..G },
    GrammarCase { id: "en/names/standard", lang: Lang::En, strictness: "standard", paragraph: "Ayşe and Siobhan met the Tauri maintainers at RustConf in Montréal, where they demoed Textus on a Pinebook.", fixes: &[], protected: &["Ayşe", "Siobhan", "Tauri", "RustConf", "Montréal", "Textus", "Pinebook"], extra: 0, ..G },
    GrammarCase { id: "en/typos-only-ignores-grammar", lang: Lang::En, strictness: "typos", paragraph: "She go to the libary every weekend because it is quiet there.", fixes: &[("libary", "library")], protected: &["go"], extra: 0, ..G },
    GrammarCase { id: "en/wordy/strict", lang: Lang::En, strictness: "strict", paragraph: "In my personal opinion, the end result of the project was the fact that the team became more closer to each other.", fixes: &[("more closer", "closer")], protected: &[], extra: 3, ..G },
    GrammarCase { id: "en/wordy/standard", lang: Lang::En, strictness: "standard", paragraph: "In my personal opinion, the end result of the project was that the team grew closer.", fixes: &[], protected: &[], extra: 0, ..G },
    GrammarCase { id: "en/dialogue/standard", lang: Lang::En, strictness: "standard", paragraph: "\"Ain't nobody got time for that,\" Grandpa said, and went back to his crossword.", fixes: &[], protected: &["Ain't nobody got time for that"], extra: 0, ..G },
    GrammarCase { id: "zh/typo/standard", lang: Lang::ZhHans, strictness: "standard", paragraph: "我们在会议上讨论了这个问题，大家一至认为应该尽快解决，不然会影响下个月的进度。", fixes: &[("一至", "一致")], protected: &[], extra: 0, ..G },
    GrammarCase { id: "zh/de-di-de/standard", lang: Lang::ZhHans, strictness: "standard", paragraph: "听到这个消息，他高兴的跳了起来，跑得比谁都快。", fixes: &[("高兴的跳", "高兴地跳")], protected: &["跑得"], extra: 0, ..G },
    GrammarCase { id: "zh/clean/standard", lang: Lang::ZhHans, strictness: "standard", paragraph: "市图书馆在一月份启动了周末读书会。一年下来，注册参与者从 120 人增长到 310 人，周日闭馆太早是大家最常提到的问题。", fixes: &[], protected: &["120", "310"], extra: 0, ..G },
    GrammarCase { id: "zh/clean/strict", lang: Lang::ZhHans, strictness: "strict", paragraph: "市图书馆在一月份启动了周末读书会。一年下来，注册参与者从 120 人增长到 310 人，周日闭馆太早是大家最常提到的问题。", fixes: &[], protected: &["120", "310"], extra: 1, ..G },
    GrammarCase { id: "zh/mixed-terms/standard", lang: Lang::Mixed, strictness: "standard", paragraph: "我们用 Tauri 重写了 editor，安装包从 180 MB 降到了 12 MB，冷启动也块了很多。", fixes: &[("块了", "快了")], protected: &["Tauri", "editor", "180 MB", "12 MB"], extra: 0, ..G },
    GrammarCase { id: "zh-Hant/wrong-script/standard", lang: Lang::ZhHant, strictness: "standard", paragraph: "我們明天要去圖書館借書。他的作業寫得很好，老師很满意。", fixes: &[("满意", "滿意")], protected: &[], extra: 0, ..G },
    GrammarCase { id: "ja/typo/standard", lang: Lang::Ja, strictness: "standard", paragraph: "昨日は友達と映画を見に行きました。とても面白かったでしだ。", fixes: &[("でしだ", "かったです。|かった。")], protected: &[], extra: 0, ..G },
    GrammarCase { id: "ja/clean/standard", lang: Lang::Ja, strictness: "standard", paragraph: "市立図書館は一月に週末読書クラブを始めました。登録参加者は一年で120人から310人に増えました。", fixes: &[], protected: &[], extra: 0, ..G },
    GrammarCase { id: "ko/typo/standard", lang: Lang::Ko, strictness: "standard", paragraph: "저는 어제 오랜만에 친구를 만낫어요. 같이 저녁을 먹고 산책을 했어요.", fixes: &[("만낫어요", "만났어요")], protected: &[], extra: 0, ..G },
    GrammarCase { id: "es/accent/standard", lang: Lang::Es, strictness: "standard", paragraph: "Ayer fuimos a la playa y nos divertimos mucho, aunque hacia demasiado calor para quedarnos toda la tarde.", fixes: &[("hacia", "hacía")], protected: &[], extra: 0, ..G },
    GrammarCase { id: "fr/agreement/standard", lang: Lang::Fr, strictness: "standard", paragraph: "Les enfants sont allé au parc hier après-midi, puis ils ont goûté chez leur grand-mère.", fixes: &[("allé", "allés")], protected: &[], extra: 0, ..G },
    GrammarCase { id: "de/participle/standard", lang: Lang::De, strictness: "standard", paragraph: "Wir haben das Buch im Urlaub gelest und danach lange darüber gesprochen.", fixes: &[("gelest", "gelesen")], protected: &[], extra: 0, ..G },
    GrammarCase { id: "de/clean/standard", lang: Lang::De, strictness: "standard", paragraph: "Die Stadtbibliothek hat im Januar einen Leseclub gegründet, und seitdem kommen deutlich mehr Jugendliche am Wochenende.", fixes: &[], protected: &[], extra: 0, ..G },
    GrammarCase { id: "ru/case/standard", lang: Lang::Ru, strictness: "standard", paragraph: "Вчера я ходил в магазин и купил хлеб, молоко и яйцы.", fixes: &[("яйцы", "яйца")], protected: &[], extra: 0, ..G },
    GrammarCase { id: "pt/agreement/standard", lang: Lang::Pt, strictness: "standard", paragraph: "Amanhã nós vai ao cinema com os meus primos.", fixes: &[("vai", "vamos")], protected: &[], extra: 0, ..G },
];

pub fn all_cases() -> Vec<&'static GrammarCase> {
    CASES
        .iter()
        .chain(super::grammar_cases::MORE)
        .filter(|c| harness::selected(c.id))
        .collect()
}

/// The paragraph with every issue applied, back to front - what accepting
/// all suggestions produces.
fn apply(paragraph: &str, issues: &[GrammarIssue]) -> Result<String, String> {
    let mut chars: Vec<char> = paragraph.chars().collect();
    let mut sorted: Vec<&GrammarIssue> = issues.iter().collect();
    sorted.sort_by_key(|i| i.start);
    for pair in sorted.windows(2) {
        if pair[1].start < pair[0].end {
            return Err("overlapping issues".into());
        }
    }
    for issue in sorted.into_iter().rev() {
        chars.splice(issue.start..issue.end, issue.suggestion.chars());
    }
    Ok(chars.into_iter().collect())
}

fn span_text(paragraph: &str, issue: &GrammarIssue) -> String {
    paragraph
        .chars()
        .skip(issue.start)
        .take(issue.end - issue.start)
        .collect()
}

/// Char range of the first occurrence of `needle` in `text`.
fn char_range(text: &str, needle: &str) -> Option<(usize, usize)> {
    text.find(needle).map(|b| {
        let start = text[..b].chars().count();
        (start, start + needle.chars().count())
    })
}

pub fn run_case(auth: &AnthropicAuth, case: &GrammarCase, model: &str) -> Record {
    let paragraph = case.text();
    let input = json!({
        "paragraph": paragraph,
        "markdown": case.markdown,
        "strictness": case.strictness,
        "expect": {
            "fixes": case.fixes,
            "protected": case.protected,
            "extra_allowed": case.extra,
        },
    });
    if let Some(reason) = harness::budget_exhausted() {
        return harness::skipped(case.id, model, case.lang.code(), reason, input);
    }
    let mut checks = Checks::default();
    let mut usage = harness::Usage::default();
    let instructions = grammar_instructions(Some(case.strictness), None);
    // Two attempts, as ai_grammar_check makes on a malformed reply.
    let (mut raw, mut latency, mut parsed) = (String::new(), 0, Err(String::new()));
    let mut attempts = 0;
    for _ in 0..2 {
        attempts += 1;
        match harness::complete(
            auth,
            &instructions,
            &grammar_user_text(&paragraph),
            harness::writing_model_arg(model),
        ) {
            Ok(reply) => {
                usage.add(&reply.model, &reply.usage);
                latency += reply.ms;
                parsed = finish_grammar(
                    &reply.text,
                    &paragraph,
                    Some(case.strictness),
                    &crate::ai::rules::Conventions::default(),
                    &[],
                    None,
                );
                raw = reply.text;
            }
            Err(e) => {
                checks.add("request", Err(e));
                break;
            }
        }
        if parsed.is_ok() {
            break;
        }
    }
    if let Some(m) = checks::meta_commentary(&raw) {
        checks.add("no meta-commentary", Err(format!("reply contains {m:?}")));
    }
    let issues = match parsed {
        Ok(issues) => issues,
        Err(e) => {
            if !raw.is_empty() {
                checks.add("parses", Err(e));
            }
            Vec::new()
        }
    };
    // What the user sees: the editor drops any fix that touches inline code.
    let issues: Vec<GrammarIssue> = match case.markdown {
        Some(md) => {
            let it = checks::inline_text(md);
            issues
                .into_iter()
                .filter(|i| {
                    !it.marks
                        .iter()
                        .any(|m| m.kind == "code" && i.start < m.end && i.end > m.start)
                })
                .collect()
        }
        None => issues,
    };
    let corrected = apply(&paragraph, &issues);
    checks.add(
        "applies cleanly",
        corrected.as_ref().map(|_| ()).map_err(Clone::clone),
    );
    let corrected = corrected.unwrap_or_default();
    for (wrong, fix) in case.fixes {
        // Any issue overlapping the mistake counts - flagging just 的 in
        // 高兴的跳 is the ideal minimal span.
        let (at, end) =
            char_range(&paragraph, wrong).expect("case error: mistake not in paragraph");
        let flagged = issues.iter().any(|i| i.start < end && i.end > at);
        checks.expect(&format!("flags {wrong:?}"), flagged, || {
            "not reported".into()
        });
        checks.expect(
            &format!("fix gives {fix:?}"),
            fix_ok(&corrected, fix),
            || format!("corrected: {corrected}"),
        );
    }
    // Accepting every suggestion must not write anything twice ("has a an
    // opinion", "uns uns").
    if !corrected.is_empty() {
        let doubled = checks::doubled_words(&paragraph, &corrected);
        checks.expect("no doubled text", doubled.is_none(), || {
            format!("{:?} in: {corrected}", doubled.clone().unwrap_or_default())
        });
    }
    // Issues that touch none of the known mistakes.
    let extras: Vec<&GrammarIssue> = issues
        .iter()
        .filter(|i| {
            !case.fixes.iter().any(|(wrong, _)| {
                let (at, end) = char_range(&paragraph, wrong).unwrap_or((0, 0));
                i.start < end && i.end > at
            })
        })
        .collect();
    checks.expect("no false positives", extras.len() <= case.extra, || {
        format!(
            "{} extra issue(s): {}",
            extras.len(),
            extras
                .iter()
                .map(|i| format!("{:?}->{:?}", span_text(&paragraph, i), i.suggestion))
                .collect::<Vec<_>>()
                .join("; ")
        )
    });
    for p in case.protected {
        if let Some((start, end)) = char_range(&paragraph, p) {
            let touched = issues.iter().any(|i| i.start < end && i.end > start);
            checks.expect(&format!("leaves {p:?} alone"), !touched, || {
                "flagged a protected span".into()
            });
        }
    }
    let descriptions: String = issues.iter().map(|i| format!("{} ", i.issue)).collect();
    if checks::word_count(&descriptions) >= 6 && case.lang != Lang::Mixed {
        checks.add(
            "issue language",
            checks::check_lang(&descriptions, case.lang),
        );
    }
    // Inline formatting: no fix may cut across bold/links or touch code,
    // and the fixes written back into the Markdown keep every marker.
    let mut corrected_markdown = None;
    if let Some(md) = case.markdown {
        let it = checks::inline_text(md);
        let spans: Vec<(usize, usize)> = issues.iter().map(|i| (i.start, i.end)).collect();
        let damage = it.damaging(&spans);
        checks.expect("formatting kept", damage.is_empty(), || damage.join("; "));
        let markup =
            |s: &str| s.contains("**") || s.contains('`') || s.contains("](") || s.contains("~~");
        checks.expect(
            "no markup in suggestions",
            !issues.iter().any(|i| markup(&i.suggestion)),
            || "a suggestion carries Markdown syntax".into(),
        );
        let edits: Vec<(usize, usize, String)> = issues
            .iter()
            .map(|i| (i.start, i.end, i.suggestion.clone()))
            .collect();
        if let Ok(fixed) = it.apply_to_markdown(md, &edits) {
            let count = |s: &str, p: &str| s.matches(p).count();
            let same = ["**", "`", "](", "~~"]
                .iter()
                .all(|p| count(md, p) == count(&fixed, p));
            checks.expect("markdown markers survive", same, || {
                format!("written back: {fixed}")
            });
            corrected_markdown = Some(fixed);
        }
    }

    let verdict = harness::judge(
        auth,
        &format!("A grammar checker in a Markdown editor reviewed one paragraph at strictness '{}' and returned issues the user can apply with one click.", case.strictness),
        &format!("Strictness scope: {}. Map the criteria as: helpfulness = recall (real mistakes in scope caught); faithfulness = precision (nothing correct flagged, no taste presented as an error, code/URLs/math/names/dialogue left alone); minimality = spans as small as possible; tone = issue descriptions natural and in the paragraph's language; correctness = each suggestion is right and reads correctly in place. Known mistakes in this paragraph: {}.", match case.strictness { "typos" => "only unambiguous typos and misspellings", "strict" => "typos, grammar, plus redundancy and unclear phrasing", _ => "typos and clear grammar mistakes, no style" }, if case.fixes.is_empty() { "none - the paragraph is correct".to_string() } else { case.fixes.iter().map(|(w, f)| format!("{w} -> {f}")).collect::<Vec<_>>().join(", ") }),
        &format!("<paragraph>{paragraph}</paragraph>\n\n<issues>\n{}\n</issues>\n\n<paragraph-after-applying-all>{corrected}</paragraph-after-applying-all>", if issues.is_empty() { "(none)".to_string() } else { issues.iter().map(|i| format!("- {:?} -> {:?}: {}", span_text(&paragraph, i), i.suggestion, i.issue)).collect::<Vec<_>>().join("\n") }),
    );
    let issue_rows: Vec<serde_json::Value> = issues
        .iter()
        .map(|i| {
            json!({
                "start": i.start,
                "end": i.end,
                "span": span_text(&paragraph, i),
                "suggestion": i.suggestion,
                "issue": i.issue,
            })
        })
        .collect();
    Record {
        case: case.id.to_string(),
        model: model.to_string(),
        lang: case.lang.code().into(),
        latency_ms: latency,
        usage,
        checks,
        verdict,
        input,
        output: json!({
            "raw": raw,
            "attempts": attempts,
            "issues": issue_rows,
            "corrected": corrected,
            "corrected_markdown": corrected_markdown,
        }),
    }
}
