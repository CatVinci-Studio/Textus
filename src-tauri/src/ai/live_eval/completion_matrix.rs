//! The completion matrix: the inline autocomplete in every tone preset,
//! across languages and block types (mid-sentence, after a sentence, list
//! item, table cell, heading, blockquote, code), with after-text, and the
//! manual trigger's alternative candidates.
//!
//! The before-text is what the editor actually sends: ProseMirror's
//! textBetween with blocks joined by blank lines - plain text, no Markdown
//! markers (ghost-text-plugin.ts's completionContext).

use super::checks::{self, Lang};
use super::harness::{self, Checks, Record};
use crate::ai::client::{
    add_writing_context, completion_prompt, finish_suggestion, CompletionHints,
    CANDIDATE_SEPARATOR, CODE_BLOCK_HINT,
};
use aicompat::providers::anthropic::AnthropicAuth;
use serde_json::json;

/// src/ai/writing/completion-style.ts's TONE_DIRECTIVES, word for word -
/// `tone_directives_match_the_frontend` below keeps the two in step.
pub const TONES: &[(&str, Option<&str>)] = &[
    ("default", None),
    ("formal", Some("Write in a formal, polished tone.")),
    ("casual", Some("Write in a relaxed, conversational tone - everyday words, contractions and short sentences, the way you would say it to a colleague; in Chinese, spoken 口语 rather than written 书面语.")),
    (
        "academic",
        Some("Write in a precise, academic tone appropriate for scholarly writing."),
    ),
    (
        "concise",
        Some("Be as concise as possible - the fewest plain words that carry the point, at the short end of the length above."),
    ),
];

#[derive(Clone)]
pub struct CompletionCase {
    pub id: String,
    pub lang: Lang,
    pub before: String,
    pub after: String,
    pub title: Option<&'static str>,
    pub section: Vec<&'static str>,
    pub block: &'static str,
    pub long: bool,
    pub tone: &'static str,
    pub candidates: Option<u8>,
    /// Expected leading space in what the user sees (Latin text only).
    pub space: Option<bool>,
    /// Inside code: judged as code, not as prose.
    pub code: bool,
    pub max_words: Option<usize>,
    /// The word the cursor sits inside, as it must read once accepted.
    pub completes: Option<&'static str>,
    pub rubric: &'static str,
    /// The project's style profile (.textus/style.md), when one is active.
    pub style_profile: Option<&'static str>,
    /// Text that must not appear in the suggestion (a banned word, a
    /// punctuation mark the profile rules out).
    pub banned: Vec<&'static str>,
}

impl CompletionCase {
    pub fn new(id: &str, lang: Lang, before: &str, block: &'static str) -> Self {
        CompletionCase {
            id: id.to_string(),
            lang,
            before: before.to_string(),
            after: String::new(),
            title: None,
            section: Vec::new(),
            block,
            long: false,
            tone: "default",
            candidates: None,
            space: None,
            code: false,
            max_words: None,
            completes: None,
            rubric: "",
            style_profile: None,
            banned: Vec::new(),
        }
    }
    pub fn title(mut self, t: &'static str, section: &[&'static str]) -> Self {
        self.title = Some(t);
        self.section = section.to_vec();
        self
    }
    pub fn long(mut self) -> Self {
        self.long = true;
        self
    }
    pub fn tone(mut self, t: &'static str) -> Self {
        self.tone = t;
        self
    }
    pub fn space(mut self, s: bool) -> Self {
        self.space = Some(s);
        self
    }
    pub fn after(mut self, a: &str) -> Self {
        self.after = a.to_string();
        self
    }
    pub fn profile(mut self, profile: &'static str, banned: &[&'static str]) -> Self {
        self.style_profile = Some(profile);
        self.banned = banned.to_vec();
        self
    }
    pub fn banned(mut self, banned: &[&'static str]) -> Self {
        self.banned = banned.to_vec();
        self
    }
    pub fn max_words(mut self, n: usize) -> Self {
        self.max_words = Some(n);
        self
    }
    pub fn candidates(mut self, n: u8) -> Self {
        self.candidates = Some(n);
        self.long = true;
        self
    }
    pub fn code(mut self) -> Self {
        self.code = true;
        self
    }
    pub fn completes(mut self, word: &'static str) -> Self {
        self.completes = Some(word);
        self
    }
    pub fn rubric(mut self, r: &'static str) -> Self {
        self.rubric = r;
        self
    }
}

const EN_MID: &str = "Our first prototype stored every edit as a full copy of the document. That was simple to reason about, but on long files it quickly";
const EN_AFTER: &str = "Remote work did not kill the office; it changed what the office is for. Teams now come in to do the things that are hard over video: onboarding, planning, and resolving disagreements.";
const ZH_AFTER: &str = "我们在三个街区做了为期两个月的访谈，共访谈了 46 位居民。大多数受访者并不反对改造，他们真正担心的是改造期间的临时安置和改造后的租金上涨。";

pub fn all_cases() -> Vec<CompletionCase> {
    let mut cases = Vec::new();
    for (tone, _) in TONES {
        cases.push(
            CompletionCase::new(
                &format!("tone/{tone}/en-mid"),
                Lang::En,
                EN_MID,
                "paragraph",
            )
            .title(
                "Designing the history panel",
                &["Designing the history panel", "Storage"],
            )
            .tone(tone)
            .space(true),
        );
        cases.push(
            CompletionCase::new(
                &format!("tone/{tone}/en-long"),
                Lang::En,
                EN_AFTER,
                "paragraph",
            )
            .title("What offices are for now", &["What offices are for now"])
            .tone(tone)
            .long()
            .space(true),
        );
        cases.push(
            CompletionCase::new(
                &format!("tone/{tone}/zh-after"),
                Lang::ZhHans,
                ZH_AFTER,
                "paragraph",
            )
            .title(
                "老城区更新的几点思考",
                &["老城区更新的几点思考", "调研发现"],
            )
            .tone(tone),
        );
    }

    let mids: &[(Lang, &str, &str)] = &[
        (Lang::ZhHans, "城市更新不只是拆旧建新。在老城区，很多居民已经在这里生活了几十年，他们的社交网络、日常习惯和对街道的记忆，都和这些建筑紧紧连在一起。因此，规划者在制定方案时", "老城区更新的几点思考"),
        (Lang::ZhHant, "城市更新不只是拆舊建新。在老城區，很多居民已經在這裡生活了幾十年，他們的社交網絡和對街道的記憶，都和這些建築緊緊連在一起。因此，規劃者在制定方案時", "老城區更新的幾點思考"),
        (Lang::Ja, "新しい図書館は駅から歩いて五分の場所にあり、平日の夜も九時まで開いている。そのため、仕事帰りの社会人が", "駅前図書館の一年"),
        (Lang::Ko, "새 도서관은 역에서 걸어서 5분 거리에 있고 평일에도 밤 9시까지 문을 연다. 그래서 퇴근길의 직장인들이", "역 앞 도서관의 1년"),
        (Lang::Es, "La nueva biblioteca está a cinco minutos a pie de la estación y abre hasta las nueve de la noche entre semana. Por eso, muchos trabajadores", "Un año de la biblioteca de la estación"),
        (Lang::Fr, "La nouvelle bibliothèque se trouve à cinq minutes à pied de la gare et reste ouverte jusqu'à 21 heures en semaine. C'est pourquoi de nombreux salariés", "Un an à la bibliothèque de la gare"),
        (Lang::De, "Die neue Bibliothek liegt fünf Gehminuten vom Bahnhof entfernt und hat werktags bis 21 Uhr geöffnet. Deshalb kommen viele Berufstätige", "Ein Jahr Bahnhofsbibliothek"),
        (Lang::Ru, "Новая библиотека находится в пяти минутах ходьбы от вокзала и по будням работает до девяти вечера. Поэтому многие сотрудники соседних офисов", "Год библиотеки у вокзала"),
        (Lang::Pt, "A nova biblioteca fica a cinco minutos a pé da estação e abre até as nove da noite durante a semana. Por isso, muitos trabalhadores", "Um ano da biblioteca da estação"),
        (Lang::Mixed, "这次重构我们把状态管理从 Redux 换成了 Zustand，bundle size 小了不少。但真正让开发体验变好的，是", "前端重构复盘"),
    ];
    for (lang, before, title) in mids {
        let latin = matches!(
            lang,
            Lang::Es | Lang::Fr | Lang::De | Lang::Ru | Lang::Pt | Lang::Ko
        );
        let mut c = CompletionCase::new(
            &format!("lang/{}/mid", lang.code()),
            *lang,
            before,
            "paragraph",
        )
        .title(title, &[title]);
        if latin {
            c = c.space(true);
        }
        cases.push(c);
    }
    cases.push(CompletionCase::new("lang/ja/long", Lang::Ja, "来館者アンケートでは、閉館時間の延長を求める声がもっとも多かった。一方で、静かに勉強できる席が足りないという意見も目立った。", "paragraph").title("駅前図書館の一年", &["駅前図書館の一年", "アンケート結果"]).long());
    cases.push(
        CompletionCase::new(
            "lang/fr/after-sentence",
            Lang::Fr,
            "Les inscriptions ont doublé en six mois.",
            "paragraph",
        )
        .title("Un an à la bibliothèque de la gare", &[])
        .space(true),
    );

    // Block types.
    let mut c = CompletionCase::new("block/en-list-item", Lang::En, "Before the release we still need to:\n\nupdate the screenshots in the README\n\nre-run the migration on a copy of production\n\nback up the", "list item")
        .title("Release checklist", &["Release checklist"])
        .space(true);
    c.max_words = Some(14);
    cases.push(c.rubric("Inside a checklist item: expect the rest of this one item only (e.g. ' production database first'), no new item, no line break."));
    let mut c = CompletionCase::new(
        "block/zh-list-item",
        Lang::ZhHans,
        "出发前还要准备：\n\n护照和签证复印件\n\n充电宝和转换插头\n\n常用",
        "list item",
    )
    .title("旅行清单", &["旅行清单"]);
    c.max_words = Some(12);
    cases.push(c.rubric(
        "Inside a packing-list item: expect the rest of this item only (e.g. 药品), no new item.",
    ));
    let mut c = CompletionCase::new("block/en-table-cell", Lang::En, "Component\n\nOwner\n\nStatus\n\nConflict resolver\n\nMia\n\nIn review\n\nSearch index\n\nTom\n\nWaiting for", "table cell")
        .title("Sync engine notes", &["Sync engine notes", "Status"])
        .space(true);
    c.max_words = Some(6);
    cases.push(c.rubric("Inside a table cell (Status column): expect a few words finishing the cell, e.g. ' review' or ' the API freeze'; never a sentence or a new cell."));
    cases.push(CompletionCase::new("block/zh-heading", Lang::ZhHans, "第三部分：", "heading").title("毕业论文写作指南", &[]).rubric("Inside a heading: expect a short heading continuation that fits a thesis-writing guide, no period, no line break."));
    cases.push(
        CompletionCase::new("block/en-heading", Lang::En, "Lessons from", "heading")
            .title("Migrating to Tauri", &[])
            .space(true)
            .rubric("Inside a heading: expect a few words completing the heading, no period."),
    );
    cases.push(
        CompletionCase::new(
            "block/en-blockquote",
            Lang::En,
            "As my editor once told me, the first draft is for",
            "blockquote",
        )
        .title("Notes on revising", &["Notes on revising"])
        .space(true),
    );

    // A code block, with the hint the editor sends since round 1 (the old
    // "paragraph" variant is gone: the editor no longer sends it, and only
    // a code block may take a multi-line completion - client.rs's
    // clean_reply).
    let code = "def average_replay_time(samples):\n    if not samples:\n        return 0.0\n    total = 0\n    for s in samples:\n        ";
    let mut c = CompletionCase::new("code/python-code-block", Lang::En, code, CODE_BLOCK_HINT)
        .title("Sync engine notes", &["Sync engine notes", "Design"]);
    c.code = true;
    cases.push(c.rubric("The cursor is inside a fenced Python code block, at the start of the loop body. Expect a code continuation (e.g. 'total += s', perhaps then the return line), valid Python with correct indentation, and no prose. Returning nothing is acceptable; prose is not."));

    // After-text present (manual trigger mid-document).
    cases.push(
        CompletionCase::new("after/en-bridge", Lang::En, "We moved the sync service to a single region in May.", "paragraph")
            .after("\n\nThe second change was to batch writes, which cut our database bill by a third.")
            .title("Cutting infrastructure costs", &["Cutting infrastructure costs"])
            .long()
            .space(true)
            .rubric("Text continues after the cursor ('The second change was to batch writes...'). Expect sentences that finish the first change's story (why a single region, what it saved) and lead into the second change without repeating it."),
    );

    // Candidates (manual trigger: long, three alternatives).
    for (lang, before, title) in [
        (
            Lang::ZhHans,
            "大多数受访者并不反对改造，他们真正担心的是改造期间的临时安置和改造后的租金上涨。",
            "老城区更新的几点思考",
        ),
        (Lang::En, EN_AFTER, "What offices are for now"),
    ] {
        let mut c = CompletionCase::new(
            &format!("candidates/{}", lang.code()),
            lang,
            before,
            "paragraph",
        )
        .title(title, &[title])
        .long();
        c.candidates = Some(3);
        if lang == Lang::En {
            c = c.space(true);
        }
        cases.push(c.rubric("Three alternatives were requested: each must follow the rules, and they should go in clearly different directions."));
    }

    // The cursor inside a word: the word must come out whole, not split
    // by a space or doubled.
    for (id, lang, before, word, title) in [
        ("midword/en", Lang::En, "Our first prototype stored every edit as a full copy of the docu", "document", "Designing the history panel"),
        ("midword/en-short-prefix", Lang::En, "The release notes should explain why we changed the defaults and what users need to do. Most of all, they should be cl", "clear", "Release notes"),
        ("midword/fr", Lang::Fr, "La nouvelle bibliothèque reste ouverte jusqu'à 21 heures en semaine. C'est pourquoi de nombreux sala", "salariés", "Un an à la bibliothèque de la gare"),
        ("midword/de", Lang::De, "Die neue Bibliothek hat werktags bis 21 Uhr geöffnet. Deshalb kommen viele Berufst", "Berufstätige", "Ein Jahr Bahnhofsbibliothek"),
    ] {
        let mut c = CompletionCase::new(id, lang, before, "paragraph").title(title, &[title]);
        c.completes = Some(word);
        cases.push(c);
    }

    // A first sentence with little context.
    cases.push(
        CompletionCase::new(
            "context/fresh-doc",
            Lang::En,
            "Dear Ms. Alvarez, thank you for",
            "paragraph",
        )
        .space(true),
    );
    cases.extend(super::completion_cases::all());
    cases.retain(|c| harness::selected(&c.id));
    cases
}

/// ghost-text-plugin.ts's stripEcho + tidySuggestion: what the user sees.
pub(super) fn shown(before: &str, raw: &str) -> String {
    let b: Vec<char> = before.chars().collect();
    let r: Vec<char> = raw.chars().collect();
    let max = b.len().min(r.len()).min(200);
    let mut out: String = raw.to_string();
    for k in (6..=max).rev() {
        if b[b.len() - k..] == r[..k] {
            out = r[k..].iter().collect();
            break;
        }
    }
    // src/utils/cjk.ts's isCjk - kana, ideographs and CJK punctuation, but
    // not Hangul: Korean spaces its words, and the editor keeps the space.
    let last_cjk = before.chars().last().is_some_and(|c| {
        matches!(c,
            '\u{3000}'..='\u{30ff}'
            | '\u{3400}'..='\u{4dbf}'
            | '\u{4e00}'..='\u{9fff}'
            | '\u{f900}'..='\u{faff}'
            | '\u{ff00}'..='\u{ffef}')
    });
    if last_cjk {
        out = out.trim_start_matches([' ', '\t']).to_string();
    }
    out
}

fn check_one(case: &CompletionCase, raw: &str, text: &str, checks: &mut Checks) {
    checks.expect("non-empty", !text.trim().is_empty() || case.code, || {
        "empty".into()
    });
    if text.trim().is_empty() {
        return;
    }
    let probe: String = case
        .before
        .trim_end()
        .chars()
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    checks.expect(
        "no echo",
        !(probe.chars().count() >= 6 && raw.trim_start().starts_with(&probe)),
        || format!("repeats {probe:?}"),
    );
    let doubled = checks::doubled_at_join(&case.before, text);
    checks.expect("no doubled text at the cursor", doubled.is_none(), || {
        format!("reads {:?} twice", doubled.unwrap_or_default())
    });
    let meta = checks::meta_commentary(text);
    checks.expect("no meta-commentary", meta.is_none(), || {
        format!("contains {:?}", meta.unwrap_or_default())
    });
    // A trailing line break counts: Tab inserts it too ("率\n\n" in a table
    // cell passed while this check trimmed it).
    if case.block != "paragraph" || !case.long {
        checks.expect("no line break", !text.contains('\n') || case.code, || {
            "line break in output".into()
        });
    }
    if case.code {
        let prose =
            text.split_whitespace().count() > 6 && !text.contains('=') && !text.contains('(');
        checks.expect("code, not prose", !prose, || "looks like prose".into());
        return;
    }
    if let Some(word) = case.completes {
        let joined = format!("{}{text}", case.before);
        let tail = &joined[case.before.rfind(' ').map_or(0, |i| i + 1)..];
        checks.expect("finishes the word", tail.starts_with(word), || {
            format!("reads {:?}", tail.chars().take(30).collect::<String>())
        });
    }
    // A figure the writer never gave: a date, amount or count made up to
    // fill a slot ("the 14th", "约 30%", "9시부터").
    let invented = checks::new_numbers(&format!("{}\n{}", case.before, case.after), text);
    checks.expect("no new figures", invented.is_empty(), || {
        format!("adds {invented:?}")
    });
    checks.add("language", checks::check_lang(text, case.lang));
    let words = checks::word_count(text);
    let cjk = matches!(
        case.lang,
        Lang::ZhHans | Lang::ZhHant | Lang::Ja | Lang::Mixed
    );
    let max = case.max_words.unwrap_or(match (case.long, cjk) {
        (false, false) => 40,
        (false, true) => 60,
        (true, false) => 130,
        (true, true) => 220,
    });
    checks.expect("length", words <= max, || format!("{words} > {max}"));
    // Each alternative of a manual trigger is a full continuation too.
    if case.long {
        let min = if cjk { 30 } else { 20 };
        checks.expect("long enough", words >= min, || {
            format!("{words} < {min} for an explicit continuation")
        });
    }
    if let Some(space) = case.space {
        let starts_space = text.starts_with(' ');
        let starts_punct = text.starts_with([',', '.', ';', ':', '!', '?']);
        checks.expect(
            "leading space",
            starts_space == space || starts_punct,
            || format!("leading space {starts_space}, expected {space}"),
        );
    }
    // An empty paragraph (after a heading, after a section): the editor
    // keeps leading whitespace there (code indentation), so prose must
    // start right at the first word.
    if case.before.ends_with('\n') {
        checks.expect(
            "starts at the word",
            !text.starts_with(char::is_whitespace),
            || format!("starts with {:?}", text.chars().next().unwrap_or(' ')),
        );
    }
    let found: Vec<&str> = case
        .banned
        .iter()
        .copied()
        .filter(|b| text.to_lowercase().contains(&b.to_lowercase()))
        .collect();
    if !case.banned.is_empty() {
        checks.expect("style profile followed", found.is_empty(), || {
            format!("uses {found:?}")
        });
    }
}

/// The request as ai_complete builds it: the prompt, plus the style profile
/// when the project has one (add_writing_context).
pub fn request_for(case: &CompletionCase) -> (String, String, Option<&'static str>) {
    let hints = CompletionHints {
        title: case.title.map(str::to_string),
        section: case.section.iter().map(|s| s.to_string()).collect(),
        block: Some(case.block.to_string()),
        length: Some(if case.long { "long" } else { "short" }.to_string()),
        candidates: case.candidates,
        ..Default::default()
    };
    let style = TONES
        .iter()
        .find(|(t, _)| *t == case.tone)
        .and_then(|(_, d)| *d);
    let (mut instructions, user_text) = completion_prompt(&case.before, &case.after, &hints, style);
    if let Some(profile) = case.style_profile {
        let ws = crate::ai::workspace::AgentWorkspace {
            style: Some(profile.to_string()),
            ..Default::default()
        };
        add_writing_context(&mut instructions, &ws, &case.before, &case.after);
    }
    (instructions, user_text, style)
}

/// Everything the case sends, for the record.
pub fn case_input(
    case: &CompletionCase,
    user_text: &str,
    style: Option<&str>,
) -> serde_json::Value {
    json!({
        "before": case.before,
        "after": case.after,
        "title": case.title,
        "section": case.section,
        "block": case.block,
        "length": if case.long { "long" } else { "short" },
        "candidates": case.candidates,
        "tone": case.tone,
        "tone_directive": style,
        "style_profile": case.style_profile,
        "expect": {
            "space": case.space,
            "completes": case.completes,
            "max_words": case.max_words,
            "code": case.code,
            "banned": case.banned,
        },
        "rubric": case.rubric,
        "user_text": user_text,
    })
}

/// Sends one completion and runs its checks: (record output, checks,
/// latency, usage).
pub fn complete_and_check(
    auth: &AnthropicAuth,
    case: &CompletionCase,
    model: &str,
    checks: &mut Checks,
) -> (serde_json::Value, u128, harness::Usage, Vec<String>) {
    let (instructions, user_text, _) = request_for(case);
    let mut usage = harness::Usage::default();
    let (raw, latency) = match harness::complete(
        auth,
        &instructions,
        &user_text,
        harness::writing_model_arg(model),
    ) {
        Ok(r) => {
            usage.add(&r.model, &r.usage);
            (r.text, r.ms)
        }
        Err(e) => {
            checks.add("request", Err(e));
            (String::new(), 0)
        }
    };
    // What ai_complete returns, then what the editor shows of it.
    let hints = CompletionHints {
        block: Some(case.block.to_string()),
        length: Some(if case.long { "long" } else { "short" }.to_string()),
        candidates: case.candidates,
        ..Default::default()
    };
    let returned = finish_suggestion(&case.before, &case.after, &raw, &hints);
    let parts: Vec<String> = if case.candidates.is_some() {
        returned
            .split(CANDIDATE_SEPARATOR)
            .map(|p| p.trim_matches('\n').to_string())
            .filter(|p| !p.trim().is_empty())
            .collect()
    } else {
        vec![returned.clone()]
    };
    let shown_parts: Vec<String> = parts.iter().map(|p| shown(&case.before, p)).collect();
    for (raw_part, text) in parts.iter().zip(&shown_parts) {
        check_one(case, raw_part, text, checks);
    }
    if let Some(n) = case.candidates {
        checks.expect("candidate count", shown_parts.len() == n as usize, || {
            format!("{} of {n}", shown_parts.len())
        });
        let max_sim = shown_parts
            .iter()
            .enumerate()
            .flat_map(|(i, a)| {
                shown_parts[i + 1..]
                    .iter()
                    .map(move |b| checks::similarity(a, b))
            })
            .fold(0.0, f64::max);
        checks.expect("candidates distinct", max_sim < 0.6, || {
            format!("similarity {max_sim:.2}")
        });
    }
    let reads_as: Vec<String> = shown_parts
        .iter()
        .map(|p| {
            format!(
                "{}⟦{p}⟧{}",
                tail(&case.before, 80),
                case.after.chars().take(40).collect::<String>()
            )
        })
        .collect();
    (
        json!({"raw": raw, "returned": returned, "shown": shown_parts, "reads_in_place": reads_as}),
        latency,
        usage,
        shown_parts,
    )
}

fn tail(text: &str, n: usize) -> String {
    let count = text.chars().count();
    text.chars().skip(count.saturating_sub(n)).collect()
}

pub fn run_case(auth: &AnthropicAuth, case: &CompletionCase, model: &str) -> Record {
    let (_, user_text, style) = request_for(case);
    let input = case_input(case, &user_text, style);
    if let Some(reason) = harness::budget_exhausted() {
        return harness::skipped(&case.id, model, case.lang.code(), reason, input);
    }
    let mut checks = Checks::default();
    let (output, latency, usage, shown_parts) = complete_and_check(auth, case, model, &mut checks);
    let tone_line = style.map_or("no tone preset".to_string(), |s| {
        format!("tone preset: {s}")
    });
    let verdict = harness::judge(
        auth,
        &format!("Inline autocomplete (grey ghost text accepted with Tab) in a Markdown editor. Block: {}. Length: {}. {tone_line}.", case.block, if case.long { "explicit continuation, 2-4 sentences" } else { "as-you-type, at most one sentence" }),
        &format!("{} Judge 'minimality' as: adds only what belongs at the cursor (no restating, no filler). Judge 'faithfulness' as consistency with the text and its facts. The suggestion is inserted exactly at ⟦cursor⟧, so judge how it reads in place, including spacing.", if case.rubric.is_empty() { "Expect a natural, specific continuation in the writer's language and voice, moving the text forward." } else { case.rubric }),
        &format!("<document-title>{}</document-title>\n<text-around-cursor>\n{}⟦cursor⟧{}\n</text-around-cursor>\n\n{}", case.title.unwrap_or(""), case.before, case.after, shown_parts.iter().enumerate().map(|(i, p)| format!("<suggestion n=\"{}\">{p}</suggestion>", i + 1)).collect::<Vec<_>>().join("\n")),
    );
    Record {
        case: case.id.clone(),
        model: model.to_string(),
        lang: case.lang.code().into(),
        latency_ms: latency,
        usage,
        checks,
        verdict,
        input,
        output,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn tone_directives_match_the_frontend() {
        let ts = include_str!("../../../../src/ai/writing/completion-style.ts");
        for (tone, directive) in super::TONES {
            assert!(
                ts.contains(&format!("{tone}:")),
                "{tone} missing from completion-style.ts"
            );
            if let Some(d) = directive {
                assert!(ts.contains(d), "directive for {tone} drifted: {d}");
            }
        }
    }

    #[test]
    fn shown_text_strips_echo_like_the_editor() {
        assert_eq!(super::shown("it quickly", "it quickly grew"), " grew");
        assert_eq!(super::shown("规划者在制定方案时", " 应当"), "应当");
        assert_eq!(super::shown("직장인들이", " 들른다"), " 들른다");
    }
}
