//! The built-in skills suite (built-in skills catalogue §1.2-§1.20 and
//! §5.10): 58 skill cases, `builtin/<skill>/<lang>/<case>`, two to four
//! per skill, and 21 routing cases, `route/<skill>/<lang>` for requests
//! whose description should load that skill and `route/none/<lang>/<case>`
//! for requests that should load none.
//!
//! Every case builds its workspace on disk and loads it through
//! workspace::load_from like the app, so the built-in layer, the user's
//! global and project skills that shadow it, the library and the style
//! profile (with its `conventions:` front matter) are what the model gets.
//! A `/name` message goes through the same expansion as the other suites
//! (agent_matrix::resolve_skill_message today; the production
//! `skills::expand_message` once it exists), and every such case also
//! checks that the message really was expanded - a missing built-in fails
//! loudly instead of quietly testing the base agent.
//!
//! Automatic checks are the catalogue's: the existing builders plus
//! `conventions_clean` (the rules engine, through conventions.rs),
//! `measured`, `register_consistent`, `max_overlap`,
//! `changed_chars_only_punct` and word or character ranges
//! (checks_builtin.rs). The rubric goes to the judge.

use super::agent_everyday::no_new_numbers;
use super::agent_matrix::{
    edit_anywhere, edit_in, either, no_edit, proposed_text, with_selection, AgentCase,
    DiskWorkspace, Expect,
};
use super::agent_workspace::{doc_folder, put, scratch};
use super::checks::{self, Lang, StructureExpect};
use super::checks_builtin::{self as cb, Metric, Register};
use super::conventions::{self, Level};
use super::docs::*;
use super::harness::{self, TurnOutcome};
use crate::ai::agent::AgentMode;

// ------------------------------------------------------------- fixtures

pub const NOVEL_JA: &str = include_str!("docs/novel-ja.md");
pub const DIALOGUE_ZH: &str = include_str!("docs/dialogue-zh.md");
pub const DIALOGUE_EN: &str = include_str!("docs/dialogue-en.md");
pub const DIALOGUE_ES: &str = include_str!("docs/dialogue-es.md");
pub const DIALOGUE_DE: &str = include_str!("docs/dialogue-de.md");
pub const AI_EN: &str = include_str!("docs/ai-en.md");
pub const AI_ZH: &str = include_str!("docs/ai-zh.md");
pub const PROOF_ZH: &str = include_str!("docs/proof-zh.md");
pub const PROOF_EN: &str = include_str!("docs/proof-en.md");
pub const PROOF_FR: &str = include_str!("docs/proof-fr.md");
pub const PROOF_KO: &str = include_str!("docs/proof-ko.md");
pub const EMAIL_KO: &str = include_str!("docs/email-ko.md");
pub const EMAIL_JA_NOTES: &str = include_str!("docs/email-ja-notes.md");
pub const QINGSHI_ZH: &str = include_str!("docs/qingshi-zh.md");
pub const GONGMUN_KO: &str = include_str!("docs/gongmun-ko.md");
pub const HAN_TW: &str = include_str!("docs/han-tw.md");
pub const OFFICE_MOVE_EN: &str = include_str!("docs/office-move-en.md");
pub const STANDUP_EN: &str = include_str!("docs/standup-en.md");
pub const ACADEMIC_TELLS_EN: &str = include_str!("docs/academic-tells-en.md");
pub const GRANT_ZH: &str = include_str!("docs/grant-zh.md");

// The one-report-per-language documents (docs.rs's LANG_DOCS).
const LANG_EN: &str = include_str!("docs/lang-en.md");
const LANG_ZH_HANS: &str = include_str!("docs/lang-zh-hans.md");
const LANG_JA: &str = include_str!("docs/lang-ja.md");
const LANG_DE: &str = include_str!("docs/lang-de.md");
const LANG_ES: &str = include_str!("docs/lang-es.md");
const LANG_FR: &str = include_str!("docs/lang-fr.md");
const LANG_PT: &str = include_str!("docs/lang-pt.md");
const LANG_RU: &str = include_str!("docs/lang-ru.md");

/// The 18 writing skills, in the catalogue's order (`theme`, which writes
/// CSS rather than prose, has no live cases).
pub const SKILLS: &[&str] = &[
    "continue-story",
    "describe",
    "dialogue",
    "imitate-style",
    "expand",
    "tighten",
    "change-tone",
    "de-ai",
    "translate",
    "proofread",
    "continuity",
    "email",
    "notice",
    "minutes",
    "academic-polish",
    "social-post",
    "headline",
    "summarize",
];

/// Hidden reference packs: loading one is not "loading a skill".
fn is_pack(name: &str) -> bool {
    name == "contract" || name == "craft" || name.starts_with("standards")
}

// Workspace files written by the cases (our own text).
const LIB_LIN_WAN: &str =
    "---\nname: 林晚\n---\n二十六岁，书店店员。不喝茶，只喝白开水。说话很少。";
const LIB_LAO_ZHOU: &str = "---\nname: 老周\n---\n书店老板，六十岁上下。话不多，心细。";
const LIB_BOOKSHOP: &str = "---\nname: 老周书店\ninclude: always\n---\n两层，木楼梯一踩就响。一楼卖旧书，二楼是阅览区。柜台上常睡着一只黑猫。";
const LIB_LIN_WAN_FIFTH_YEAR: &str = "---\nname: 林晚\n---\n书店店员。今年是她来这座城市的第五年。";
const LIB_TOM: &str =
    "---\nname: Tom\n---\n34, tall, wears his late father's watch, always carries a paperback.";
const STYLE_ZH_FICTION: &str = "---\nconventions: zh-Hans-CN/fiction\n---\n\n# 文风档案\n\n## 句子与节奏\n\n- 短句为主，很少超过 25 个字。\n\n## 从不\n\n- 不用感叹号。";
const STYLE_EN_PROFILE: &str = "# Style profile\n\n## Voice\n\n- Second person.\n\n## Sentences\n\n- Sentences under 15 words.\n\n## Never\n\n- Never use semicolons.";
const STYLE_FR_FR: &str =
    "---\nconventions: fr-FR\n---\n\n# Profil de style\n\n## Ton\n\n- Sobre et informatif.";
const SAMPLE_ZH: &str = "雨停了。街上很静。你走过去，推开门。灯是黄的。没人说话。\n\n桌上有一杯水。水凉了。你没有喝。你坐下来，看着窗外。车一辆一辆地过去。\n\n后来天黑了。你站起来，关了灯。门在身后合上。";
const SAMPLE_EN: &str = "The train is late. You stand on the platform and wait.\n\nA man sells coffee from a cart. You buy one. It is too hot to drink.\n\nThe board changes. Nobody moves. Then the rails start to hum.";
const CHAPTER_6_EN: &str = "# Chapter 6\n\nTom never carried a phone; he said they rotted the mind. Elena had stopped arguing with him about it years ago.";
const PROJECT_HEADLINE: &str = "---\nname: headline\ndescription: Write or rewrite document titles in the house style\n---\nHouse style for titles: sentence case, at most 6 words, no colon, lead with the concrete result.";

// ------------------------------------------------------------- workspaces

/// The document in a fresh folder of its own (the project folder), plus
/// `files` (relative path, text) beside it.
fn folder(name: &str, doc_file: &str, doc: &str, files: &[(&str, &str)]) -> DiskWorkspace {
    let dir = scratch(name);
    for (rel, text) in files {
        put(&dir, rel, text);
    }
    DiskWorkspace {
        global: market_skills(name),
        ..doc_folder(&dir, doc_file, doc)
    }
}

/// The skills built in until 1.3, in the market since
/// (textus-plugins/skills): installed in the case's global folder, as a
/// user who had them on has them. TEXTUS_PLUGINS_DIR, or a
/// textus-plugins checkout in a folder above this one; none without.
fn market_skills(name: &str) -> Option<std::path::PathBuf> {
    let source = plugins_checkout()?.join("skills");
    let global = scratch(&format!("{name}-global"));
    let skills = global.join("skills");
    std::fs::create_dir_all(&skills).ok()?;
    for entry in std::fs::read_dir(&source).ok()?.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "md") {
            std::fs::copy(&path, skills.join(entry.file_name())).ok()?;
        }
    }
    Some(global)
}

/// The checkout's official plugins, as installed ones.
pub(crate) fn checkout_plugins() -> Vec<crate::plugins::install::InstalledPlugin> {
    let Some(root) = plugins_checkout() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(root.join("plugins")) else {
        return Vec::new();
    };
    let mut out: Vec<_> = entries
        .flatten()
        .filter_map(|e| {
            let dir = e.path();
            let manifest = std::fs::read_to_string(dir.join("textus-plugin.json")).ok()?;
            Some(crate::plugins::install::InstalledPlugin {
                id: e.file_name().to_string_lossy().into_owned(),
                dir: dir.to_string_lossy().into_owned(),
                manifest,
                dev: false,
            })
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

fn plugins_checkout() -> Option<std::path::PathBuf> {
    if let Some(dir) = std::env::var_os("TEXTUS_PLUGINS_DIR") {
        return Some(dir.into());
    }
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .map(|d| d.join("textus-plugins"))
        .find(|d| d.join("libs.json").is_file())
}

/// Every word of `words` in some comment, with the fix it names.
fn comments_mention(
    words: &'static [&'static str],
) -> impl Fn(&TurnOutcome) -> Result<(), String> + Send + Sync {
    move |o| {
        let missing: Vec<&str> = words
            .iter()
            .copied()
            .filter(|w| !o.comments.iter().any(|(_, c)| c.contains(w)))
            .collect();
        missing
            .is_empty()
            .then_some(())
            .ok_or_else(|| format!("no comment names {missing:?}"))
    }
}

/// A fenced block in the reply whose info string is `info` and whose text
/// holds every one of `holds`.
fn reply_block(
    info: &'static str,
    holds: &'static [&'static str],
) -> impl Fn(&TurnOutcome) -> Result<(), String> + Send + Sync {
    move |o| {
        let open = format!("```{info}");
        let start = o
            .reply
            .find(&open)
            .ok_or_else(|| format!("no ```{info} block"))?;
        let block = &o.reply[start..];
        let missing: Vec<&str> = holds
            .iter()
            .copied()
            .filter(|h| !block.contains(h))
            .collect();
        missing
            .is_empty()
            .then_some(())
            .ok_or_else(|| format!("the ```{info} block lacks {missing:?}"))
    }
}

fn plain(name: &str, doc: &str) -> DiskWorkspace {
    folder(name, "doc.md", doc, &[])
}

// ------------------------------------------------------------- checks

/// The skills `use_skill` loaded this turn (packs and `#section` aside).
pub fn skills_loaded(o: &TurnOutcome) -> Vec<String> {
    o.calls
        .iter()
        .filter(|c| c["name"] == "use_skill")
        .filter_map(|c| c["args"]["name"].as_str())
        .map(|n| n.split('#').next().unwrap_or(n).trim().to_string())
        .filter(|n| !is_pack(n))
        .collect()
}

fn loads(skill: &'static str) -> impl Fn(&TurnOutcome) -> Result<(), String> + Send + Sync {
    move |o| {
        let loaded = skills_loaded(o);
        loaded
            .iter()
            .any(|n| n == skill)
            .then_some(())
            .ok_or_else(|| format!("loaded {loaded:?}, not {skill}"))
    }
}

fn loads_none(o: &TurnOutcome) -> Result<(), String> {
    let loaded = skills_loaded(o);
    loaded
        .is_empty()
        .then_some(())
        .ok_or_else(|| format!("loaded {loaded:?}"))
}

/// Nothing, or only `skill` (a request where loading it is acceptable but
/// costs a round trip, which the record's latency shows).
fn loads_at_most(skill: &'static str) -> impl Fn(&TurnOutcome) -> Result<(), String> + Send + Sync {
    move |o| {
        let other: Vec<String> = skills_loaded(o)
            .into_iter()
            .filter(|n| n != skill)
            .collect();
        other
            .is_empty()
            .then_some(())
            .ok_or_else(|| format!("loaded {other:?}"))
    }
}

/// A `/name` message went out expanded into that skill.
fn expanded(skill: String) -> impl Fn(&TurnOutcome) -> Result<(), String> + Send + Sync {
    move |o| {
        o.message_sent
            .contains(&format!("<skill name=\"{skill}\""))
            .then_some(())
            .ok_or_else(|| format!("/{skill} was not expanded - is the built-in loaded?"))
    }
}

fn has_any(
    any: &'static [&'static str],
) -> impl Fn(&TurnOutcome) -> Result<(), String> + Send + Sync {
    move |o| {
        any.iter()
            .any(|n| o.doc_after.contains(n))
            .then_some(())
            .ok_or_else(|| format!("none of {any:?} in the result"))
    }
}

fn proposed_has_any(
    any: &'static [&'static str],
) -> impl Fn(&TurnOutcome) -> Result<(), String> + Send + Sync {
    move |o| {
        let text = proposed_text(o);
        any.iter()
            .any(|n| text.contains(n))
            .then_some(())
            .ok_or_else(|| format!("none of {any:?} in the new text"))
    }
}

fn proposed_lacks(
    bad: &'static [&'static str],
) -> impl Fn(&TurnOutcome) -> Result<(), String> + Send + Sync {
    move |o| {
        let text = proposed_text(o);
        let found: Vec<&&str> = bad.iter().filter(|b| text.contains(**b)).collect();
        found
            .is_empty()
            .then_some(())
            .ok_or_else(|| format!("new text has {found:?}"))
    }
}

/// The reply or one of the comments mentions one of these.
fn says_any(
    any: &'static [&'static str],
) -> impl Fn(&TurnOutcome) -> Result<(), String> + Send + Sync {
    move |o| {
        let all = std::iter::once(o.reply.clone())
            .chain(o.comments.iter().map(|(_, c)| c.clone()))
            .collect::<Vec<_>>()
            .join("\n")
            .to_lowercase();
        any.iter()
            .any(|w| all.contains(&w.to_lowercase()))
            .then_some(())
            .ok_or_else(|| format!("neither the reply nor a comment mentions any of {any:?}"))
    }
}

fn within(
    from: &'static str,
    to: &'static str,
) -> impl Fn(&TurnOutcome) -> Result<(), String> + Send + Sync {
    move |o| cb::span_within(&o.doc_before, &o.doc_after, from, to)
}

/// The citations in square brackets - numbers, ranges and `@` cite keys,
/// one per item, whether or not the editor escaped the bracket.
pub fn bracket_citations(text: &str) -> std::collections::BTreeSet<String> {
    let mut out = std::collections::BTreeSet::new();
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        let Some(close) = rest[open..].find(']') else {
            break;
        };
        let inside = &rest[open + 1..open + close];
        rest = &rest[open + close + 1..];
        let items: Vec<&str> = inside
            .split([',', ';'])
            .map(|s| s.trim().trim_start_matches('@'))
            .collect();
        if items.iter().all(|s| {
            !s.is_empty()
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '–' | '_' | ':'))
        }) {
            out.extend(items.into_iter().map(str::to_string));
        }
    }
    out
}

/// Every bracketed citation in the document survives, none is added.
fn citations_kept(o: &TurnOutcome) -> Result<(), String> {
    let (before, after) = (
        bracket_citations(&o.doc_before),
        bracket_citations(&o.doc_after),
    );
    (before == after)
        .then_some(())
        .ok_or_else(|| format!("citations {before:?} -> {after:?}"))
}

fn appended(o: &TurnOutcome) -> Result<(), String> {
    o.doc_after
        .starts_with(o.doc_before.trim_end())
        .then_some(())
        .ok_or_else(|| "changed the existing text instead of adding after it".into())
}

fn same_headings(o: &TurnOutcome) -> Result<(), String> {
    let count = |d: &str| d.lines().filter(|l| cb::first_heading(l).is_some()).count();
    let (a, b) = (count(&o.doc_before), count(&o.doc_after));
    (a == b)
        .then_some(())
        .ok_or_else(|| format!("{a} headings -> {b}"))
}

/// `of` measured by `metric` lies within `min..=max`.
fn measured(
    metric: Metric,
    min: usize,
    max: usize,
    of: fn(&TurnOutcome) -> String,
) -> impl Fn(&TurnOutcome) -> Result<(), String> + Send + Sync {
    move |o| {
        let n = cb::measure(metric, &of(o));
        (min..=max)
            .contains(&n)
            .then_some(())
            .ok_or_else(|| format!("{} {n}, want {min}-{max}", metric.name()))
    }
}

/// `of` is in one register; with `want`, that one.
fn register(
    lang: Lang,
    want: Option<Register>,
    of: fn(&TurnOutcome) -> String,
) -> impl Fn(&TurnOutcome) -> Result<(), String> + Send + Sync {
    move |o| match (cb::register_of(&of(o), lang)?, want) {
        (Some(found), Some(w)) if found != w => Err(format!("{found:?}, want {w:?}")),
        _ => Ok(()),
    }
}

fn sentences_at_most(words: usize) -> impl Fn(&TurnOutcome) -> Result<(), String> + Send + Sync {
    move |o| {
        let long: Vec<String> = checks::sentences(&proposed_text(o))
            .into_iter()
            .filter(|s| checks::word_count(s) > words)
            .collect();
        long.is_empty()
            .then_some(())
            .ok_or_else(|| format!("{} sentence(s) over {words} words: {:?}", long.len(), long))
    }
}

/// The edit's new text is at least `share` shorter than what it replaced.
fn shorter_by(share: f64) -> impl Fn(&TurnOutcome) -> Result<(), String> + Send + Sync {
    move |o| {
        if o.doc_after == o.doc_before {
            return Err("nothing changed".into());
        }
        let (before, after) = cb::changed_blocks(&o.doc_before, &o.doc_after);
        let (old, new) = (checks::word_count(&before), checks::word_count(&after));
        (new as f64 <= old as f64 * (1.0 - share))
            .then_some(())
            .ok_or_else(|| {
                format!(
                    "{old} -> {new} words, want at least {:.0}% shorter",
                    share * 100.0
                )
            })
    }
}

fn reply_items(n: usize) -> impl Fn(&TurnOutcome) -> Result<(), String> + Send + Sync {
    move |o| {
        let items = cb::top_level_items(&o.reply);
        (items.len() == n)
            .then_some(())
            .ok_or_else(|| format!("{} list items in the reply, want {n}", items.len()))
    }
}

fn no_simplified(o: &TurnOutcome) -> Result<(), String> {
    let found = checks::simplified_only(&proposed_text(o));
    found
        .is_empty()
        .then_some(())
        .ok_or_else(|| format!("Simplified-only characters {found:?}"))
}

fn h1(o: &TurnOutcome) -> String {
    cb::first_heading(&o.doc_after).unwrap_or_default()
}

fn post(o: &TurnOutcome) -> String {
    cb::body_without_headings(&proposed_text(o))
}

fn new_text(o: &TurnOutcome) -> String {
    proposed_text(o)
}

/// Extra checks the catalogue names, chained onto the existing builders.
trait BuiltinExpect {
    fn conventions_clean(self, profile: &'static str) -> Self;
    fn no_new_numbers(self) -> Self;
    fn loads(self, skill: &'static str) -> Self;
}

impl BuiltinExpect for Expect {
    /// No P0 or P1 rules-engine finding in the paragraphs the edit wrote.
    fn conventions_clean(self, profile: &'static str) -> Self {
        let name = conventions::check_name(profile, conventions::engine().is_some());
        let name: &'static str = Box::leak(name.into_boxed_str());
        self.check(name, move |o| {
            conventions::clean_edit(&o.doc_before, &o.doc_after, profile, Level::Standard)
        })
    }
    fn no_new_numbers(self) -> Self {
        self.check("no new numbers", no_new_numbers)
    }
    /// use_skill was called, for this skill.
    fn loads(self, skill: &'static str) -> Self {
        self.tools(&["use_skill"])
            .check("loads the skill", loads(skill))
    }
}

// ------------------------------------------------------------- skill cases

fn write_cases() -> Vec<AgentCase> {
    let mut c = Vec::new();

    // continue-story
    let ws = folder(
        "cs-zh",
        "第三章.md",
        NOVEL_ZH,
        &[
            (".textus/library/林晚.md", LIB_LIN_WAN),
            (".textus/library/老周.md", LIB_LAO_ZHOU),
            (".textus/style.md", STYLE_ZH_FICTION),
        ],
    );
    c.push(AgentCase::new("builtin/continue-story/zh/next-scene", Lang::ZhHans, Lang::ZhHans, NOVEL_ZH, "/continue-story 接着写这一场，三五百字", edit_anywhere().longer().lacks(&["！"]).check("250-700 characters", measured(Metric::CjkChars, 250, 700, new_text)).check("no new heading", same_headings).conventions_clean("zh-Hans-CN/fiction"), "Continues right after 水壶响起来 / 第三年, with no recap. The library says 林晚 doesn't drink tea, only plain water - she must not drink tea. The style profile's limits are rules: short sentences (rarely over 25 characters), no exclamation marks. About 300-500 characters, 林晚's point of view, 老周 consistent with his entry. Reply: one or two Chinese sentences on what happens.").disk(ws));

    let ws = plain("cs-en", NOVEL_EN);
    c.push(AgentCase::new("builtin/continue-story/en/route", Lang::En, Lang::En, NOVEL_EN, "What happens next? Write the next part of the scene.", edit_anywhere().loads("continue-story").check("added after the last paragraph", appended).check("no adverb speech tags", |o| {
        let tags = cb::adverb_tags(&proposed_text(o));
        tags.is_empty().then_some(()).ok_or_else(|| format!("{tags:?}"))
    }).conventions_clean("en-US/general"), "Matched by description (no /): expect use_skill continue-story, then one insertion after the last paragraph. Keeps Elena's point of view and the past tense; US dialogue punctuation; Tom's phone is dead and stays dead; no adverb-heavy tags; something moves in the scene; no moral at the end.").disk(ws));

    let ws = plain("cs-ja", NOVEL_JA);
    c.push(AgentCase::new("builtin/continue-story/ja/dialogue", Lang::Ja, Lang::Ja, NOVEL_JA, "/continue-story", edit_anywhere().check("speech in 「」", proposed_has_any(&["「"])).check("no 。 before 」", proposed_lacks(&["。」", "...", "。。。"])).check("…… and ―― in pairs", |o| {
        let text = proposed_text(o);
        let lone: Vec<usize> = cb::unpaired(&text, '…').into_iter().chain(cb::unpaired(&text, '―')).collect();
        lone.is_empty().then_some(()).ok_or_else(|| format!("unpaired runs {lone:?}"))
    }), "/continue-story with no arguments: the next part of the scene at the station in natural Japanese fiction prose, from 美咲's point of view, picking up after 健太's apology. Speech in 「」 with no 。 before 」; …… and ―― as pairs; no ASCII dots. The reply is a short Japanese note.").disk(ws));

    let ws = plain("cs-zh-options", NOVEL_ZH);
    c.push(AgentCase::new("builtin/continue-story/zh/options", Lang::ZhHans, Lang::ZhHans, NOVEL_ZH, "/continue-story 先给我三个后续走向，别写正文", no_edit().check("three options", reply_items(3)), "The user asked for directions, not text: no edit, three candidate next beats of one or two sentences each, all consistent with the scene (rain, the bookshop, 老周 boiling water, her third year in the city); none resolves everything or introduces a major new character.").disk(ws));

    // describe
    let ws = folder(
        "describe-zh",
        "第三章.md",
        NOVEL_ZH,
        &[(".textus/library/老周书店.md", LIB_BOOKSHOP)],
    );
    c.push(AgentCase::new("builtin/describe/zh/bookshop", Lang::ZhHans, Lang::ZhHans, NOVEL_ZH, "/describe 在第一段后面加一段书店里面的描写", edit_anywhere().longer().check("after the first paragraph", within("雨从傍晚开始下", "“你还没走？”")).has(&["“你还没走？”老周从里屋探出头来。"]).check("uses the library", proposed_has_any(&["木楼梯", "黑猫"])).lacks(&["三层"]).conventions_clean("zh-Hans-CN"), "One new paragraph right after the first, describing the inside of the bookshop as 林晚 sees it from the door. The library entry (two floors, a creaky wooden staircase, old books downstairs, reading room upstairs, a black cat asleep on the counter) is the source of truth; a few chosen details, not a catalogue; no new characters or events.").disk(ws));

    let ws = folder(
        "describe-en",
        "chapter-7.md",
        NOVEL_EN,
        &[(".textus/library/Tom.md", LIB_TOM)],
    );
    c.push(AgentCase::new("builtin/describe/en/character", Lang::En, Lang::En, NOVEL_EN, "Describe Tom when he finally appears at the station.", edit_anywhere().loads("describe").check("near his arrival", within("The rain had not stopped", "\"The bus broke down,\"")).has(&["\"The bus broke down,\" he replied apologetically."]).check("uses the library", proposed_has_any(&["watch"])).no_new_numbers(), "Matched by description. A short action-led description of Tom as he appears, through Elena's eyes, using the library (tall, his late father's watch, a paperback) without contradicting it; the dialogue that follows stays as it is.").disk(ws));

    let ws = plain("describe-zh-essay", ESSAY_ZH);
    c.push(AgentCase::new("builtin/describe/zh/essay-no-invent", Lang::ZhHans, Lang::ZhHans, ESSAY_ZH, "/describe 让外婆厨房那段更有画面感", edit_anywhere().longer().check("in the kitchen paragraphs", within(para(ESSAY_ZH, 0), para(ESSAY_ZH, 1))).no_new_numbers().lacks(&["舅妈", "外公说", "姨妈"]), "A memoir, not fiction: the kitchen paragraph(s) get more sights, smells and sounds that the text already implies (the dim north-facing room, the tiled stove, lard and sugar, chopping, the fire, lifting the lid), and no new events, people or quotations.").disk(ws));

    // dialogue
    let ws = plain("dialogue-zh", DIALOGUE_ZH);
    c.push(AgentCase::new("builtin/dialogue/zh/punct", Lang::ZhHans, Lang::ZhHans, DIALOGUE_ZH, "/dialogue 只改标点", edit_anywhere().lacks(&["\"", ",\"", ".\""]).has(&["问：“车什么时候到？”", "“快了。”", "“那我先去买杯水。”"]).check("only punctuation changed", |o| cb::changed_chars_only_punct(&o.doc_before, &o.doc_after)).conventions_clean("zh-Hans-CN/fiction"), "Pure punctuation fix: ASCII quotes and points become “” and full-width 。，：？ by the GB/T 15834 dialogue patterns; …… kept; not one word changed.").disk(ws));

    let ws = plain("dialogue-en", DIALOGUE_EN);
    c.push(AgentCase::new("builtin/dialogue/en/tags", Lang::En, Lang::En, DIALOGUE_EN, "/dialogue", edit_anywhere().has(&["\"Where?\" he asked"]).check("tags take a comma", |o| {
        let bad = cb::missing_tag_commas(&o.doc_after);
        bad.is_empty().then_some(()).ok_or_else(|| format!("{bad:?}"))
    }).conventions_clean("en-US/general"), "Fixes the tag punctuation (comma inside the quote before said/replied; lowercase he after a question). May replace one adverb tag (angrily) with a beat; the spoken words stay the same.").disk(ws));

    let ws = plain("dialogue-es", DIALOGUE_ES);
    c.push(AgentCase::new("builtin/dialogue/es/raya", Lang::Es, Lang::Es, DIALOGUE_ES, "/dialogue", edit_anywhere().check("raya rules", |o| {
        let doc = o.doc_after.replace('\u{2015}', "\u{2014}");
        let want = ["—Espero que sí —dijo Azucena—. Vámonos ya.", "—¿Ahora? —preguntó Tomás.", "—Ahora."];
        let missing: Vec<&&str> = want.iter().filter(|w| !doc.contains(**w)).collect();
        missing.is_empty().then_some(()).ok_or_else(|| format!("missing {missing:?}"))
    }), "RAE raya rules applied exactly: a raya (U+2014) opens each turn with no space after it; narrator incisos between rayas; the period after the closing raya; lowercase after the verb of saying. Words unchanged.").disk(ws));

    let ws = plain("dialogue-de", DIALOGUE_DE);
    c.push(AgentCase::new("builtin/dialogue/de/comma", Lang::De, Lang::De, DIALOGUE_DE, "Korrigiere die Zeichensetzung der wörtlichen Rede.", edit_anywhere().loads("dialogue").has(&["„Komm bald wieder!“, rief sie.", "„Ich warte“, sagte er leise."]).conventions_clean("de-DE"), "Matched by description. §79 E1: comma after the closing quote when the reporting clause follows, even after ! or ?, and the quoted statement drops its period. Nothing else changes.").disk(ws));

    // imitate-style
    let ws = folder(
        "imitate-zh",
        "report.md",
        LANG_ZH_HANS,
        &[("samples/voice.md", SAMPLE_ZH)],
    );
    c.push(AgentCase::new("builtin/imitate-style/zh/sample-file", Lang::ZhHans, Lang::ZhHans, LANG_ZH_HANS, "/imitate-style 用 samples/voice.md 的文风改写“方法”这一段", edit_in(para(LANG_ZH_HANS, 1), StructureExpect::Same).tools(&["read_file"]).has(&["一月", "十二月", "问卷"]).check("short clauses", |o| {
        let mean = cb::mean_clause_cjk(&proposed_text(o));
        (mean <= 14.0).then_some(()).ok_or_else(|| format!("mean clause {mean:.1} characters"))
    }).check("borrows no sentences", |o| cb::max_overlap(SAMPLE_ZH, &proposed_text(o), 6)), "Reads the sample, then rewrites only the Method paragraph in its manner: short, plain clauses. Content intact (the whole year January to December, attendance at every session, a short monthly paper questionnaire about the club and how it was run); nothing borrowed from the sample's sentences or images.").disk(ws));

    let ws = folder(
        "imitate-en",
        "report.md",
        LANG_EN,
        &[(".textus/style.md", STYLE_EN_PROFILE)],
    );
    c.push(AgentCase::new("builtin/imitate-style/en/profile", Lang::En, Lang::En, LANG_EN, "/imitate-style rewrite the Method paragraph in my style", edit_in(para(LANG_EN, 1), StructureExpect::Same).check("sentences of 18 words at most", sentences_at_most(18)).check("no semicolons", proposed_lacks(&[";"])).check("second person", |o| {
        let t = proposed_text(o).to_lowercase();
        t.split(|c: char| !c.is_alphabetic()).any(|w| w == "you" || w == "your").then_some(()).ok_or_else(|| "no you".into())
    }), "The style profile's limits are rules (second person, sentences under 15 words, no semicolons). Only the Method paragraph changes, with every fact kept.").disk(ws));

    c
}

fn revise_cases() -> Vec<AgentCase> {
    let mut c = Vec::new();

    // expand
    let ws = plain("expand-budget", BUDGET_EN);
    c.push(AgentCase::new("builtin/expand/en/budget-tbd", Lang::En, Lang::En, BUDGET_EN, "/expand the Costs section", either().check("asks or keeps TBD", |o| {
        if o.proposals.is_empty() {
            return o.reply.contains('?').then_some(()).ok_or_else(|| "no edit and no question about the figures".into());
        }
        no_new_numbers(o)?;
        o.doc_after.contains("TBD").then_some(()).ok_or_else(|| "TBD replaced".into())
    }), "The costs are TBD: the skill must not invent prices. Either it asks for the figures, or it expands the section around the unknowns (what the costs cover, when they'll be known) keeping TBD, with no number near 'cost'.").disk(ws));

    let ws = plain("expand-essay", ESSAY_ZH);
    c.push(AgentCase::new("builtin/expand/zh/essay", Lang::ZhHans, Lang::ZhHans, ESSAY_ZH, "/expand 第三段", edit_in(para(ESSAY_ZH, 2), StructureExpect::Same).longer().no_new_numbers().lacks(&["舅妈", "姨妈", "表哥", "表姐"]), "Grows the third paragraph from what it already implies - the house sold, the move to the uncle's, the taste that can't be had again - with no new events, people or figures.").disk(ws));

    let decisions = checks::lines_between(MEETING_EN, "* Ship", "* Keep");
    let ws = plain("expand-list", MEETING_EN);
    c.push(AgentCase::new("builtin/expand/en/list", Lang::En, Lang::En, MEETING_EN, "/expand each decision into one or two sentences", edit_in(&decisions, StructureExpect::Same).longer().no_new_numbers(), "Each of the three decisions grows into one or two sentences explained from what the notes say (offline mode behind a flag in 1.4; dropping the Windows 7 installer at under 0.5% usage; the $8 price until the January review); still three items; nothing invented.").disk(ws));

    // tighten
    let ws = plain("tighten-de", LANG_DE);
    c.push(AgentCase::new("builtin/tighten/de/method", Lang::De, Lang::De, LANG_DE, "/tighten Methode", edit_in(para(LANG_DE, 1), StructureExpect::Same).check("20% shorter", shorter_by(0.2)).has(&["Januar", "Dezember", "Fragebogen"]).conventions_clean("de-DE"), "Natural, tighter German: fewer doublets and less Nominalstil, every fact kept (the whole year, attendance at every session, a monthly paper questionnaire about the club and its organisation).").disk(ws));

    let ws = plain("tighten-ja", LANG_JA);
    c.push(AgentCase::new("builtin/tighten/ja/method", Lang::Ja, Lang::Ja, LANG_JA, "/tighten 方法の段落", edit_in(para(LANG_JA, 1), StructureExpect::Same).check("20% shorter", shorter_by(0.2)).has(&["1月", "12月", "アンケート"]).check("still です・ます", register(Lang::Ja, Some(Register::JaPolite), new_text)), "Shorter, still です・ます, no information lost (the year, every session's attendance, the monthly paper questionnaire).").disk(ws));

    let ws = plain("tighten-en", ACADEMIC_EN);
    c.push(AgentCase::new("builtin/tighten/en/target", Lang::En, Lang::En, ACADEMIC_EN, "/tighten the literature paragraph to about 80 words", edit_in(para(ACADEMIC_EN, 0), StructureExpect::Same).has(&["Bloom et al. (2015)", "13%", "Gibbs, Mengel and Siemroth (2023)", "Emanuel & Harrington, 2024"]).check("64-96 words", measured(Metric::Words, 64, 96, new_text)).check("no semicolons", proposed_lacks(&[";"])), "Hits about 80 words by cutting (the throat-clearing opener, 'to put it mildly', 'basically'), not by joining sentences with semicolons; every citation and figure intact; the hedge 'depends on' kept.").disk(ws));

    // change-tone
    let ws = plain("tone-ja", LANG_JA);
    c.push(AgentCase::new("builtin/change-tone/ja/dearu", Lang::Ja, Lang::Ja, LANG_JA, "/change-tone 本文をである調に統一して", edit_anywhere().lacks(&["です。", "ます。", "でした。", "ました。"]).has(&["120", "310"]).check("one register, である", register(Lang::Ja, Some(Register::JaPlain), |o| o.doc_after.clone())), "Natural である style throughout the body; headings untouched; every number and fact kept.").disk(ws));

    let ws = plain("tone-ko", EMAIL_KO);
    c.push(AgentCase::new("builtin/change-tone/ko/formal", Lang::Ko, Lang::Ko, EMAIL_KO, "/change-tone 하십시오체로", edit_anywhere().lacks(&["까요?", "드릴게요", "부탁드려요", "드림."]).has(&["습니다", "박민수 드림"]).check("one register, 하십시오체", register(Lang::Ko, Some(Register::KoFormal), |o| o.doc_after.clone())), "Consistent 하십시오체 (no 해요체 left), facts unchanged (Tuesday -> Thursday 3 p.m., materials by Wednesday), the signature 박민수 드림 kept without a period.").disk(ws));

    let ws = plain("tone-en", MOVING_EN);
    c.push(AgentCase::new("builtin/change-tone/en/plain", Lang::En, Lang::En, MOVING_EN, "/change-tone plain English", edit_anywhere().lacks(&["leverage", "utilize", "incredibly"]).check("sentences of 25 words at most", sentences_at_most(25)).check("two weeks kept", has_any(&["2 full weeks", "two weeks", "2 weeks", "two full weeks"])), "Plain English: everyday words, short sentences, the same facts (across town, two weeks, packing, cancelling contracts, the internet, the checklist); no lecture about plain English.").disk(ws));

    let ws = plain("tone-zh", EMAIL_ZH);
    c.push(AgentCase::new("builtin/change-tone/zh/firm", Lang::ZhHans, Lang::ZhHans, EMAIL_ZH, "/change-tone 语气更坚决一点，但保持礼貌", edit_anywhere().check("body paragraphs only", within("原定于", "请告诉我们您方便的时间。")).has(&["10 月 24 日", "王经理您好：", "李明"]).check("time kept", has_any(&["十点", "10:00", "10 点", "10点"])).conventions_clean("zh-Hans-CN"), "Firmer but still courteous; no new demands or deadlines; the date, time, place and agenda unchanged; salutation and closing untouched.").disk(ws));

    // de-ai
    let ws = plain("deai-en", AI_EN);
    c.push(AgentCase::new("builtin/de-ai/en/rewrite", Lang::En, Lang::En, AI_EN, "/de-ai", edit_anywhere().lacks(&["In today's fast-paced world", "testament", "delve", "tapestry", "pivotal", "In conclusion", "boasts", "serves as"]).has(&["3 March", "48 seats", "Ana Ruiz", "\"We moved 2,000 books here in one week.\""]).no_new_numbers(), "Plain, specific prose with every fact kept (3 March, 48 seats, Wi-Fi, booths, the printing corner); no invented anecdote or fake human voice; the quotation untouched.").disk(ws));

    let ws = plain("deai-zh", AI_ZH);
    c.push(AgentCase::new("builtin/de-ai/zh/rewrite", Lang::ZhHans, Lang::ZhHans, AI_ZH, "/de-ai", edit_anywhere().lacks(&["随着数字化时代的不断发展", "不仅仅是", "赋能", "彰显了", "总而言之", "拭目以待"]).has(&["3 月 3 日", "48 个座位", "李娜", "“我们一周就搬了 2000 本书。”"]).no_new_numbers(), "Direct, concrete Chinese; the facts (opened 3 March, 48 seats) and the quotation intact; nothing invented to sound human.").disk(ws));

    let ws = plain("deai-zh-check", AI_ZH);
    c.push(AgentCase::new("builtin/de-ai/zh/check-only", Lang::ZhHans, Lang::ZhHans, AI_ZH, "帮我看看哪里有 AI 味，先别改", no_edit().comments().check("comments in Chinese", |o| {
        o.comments.iter().try_for_each(|(_, c)| checks::check_lang(c, Lang::ZhHans))
    }).check("no authorship verdict", |o| {
        ["AI 生成", "AI生成", "由 AI 写", "由AI写"].iter().find(|w| o.reply.contains(**w)).map_or(Ok(()), |w| Err(format!("reply says {w:?}")))
    }), "Check only: comments pinned to the passages, each naming the pattern (时代开头, 不仅仅是…更是, 赋能, 彰显了, 总而言之…拭目以待) and why; no edits; no claim about who or what wrote the text.").mode(AgentMode::Review).disk(ws));

    let novel = NOVEL_EN.replace(
        "\"The bus broke down,\" he replied apologetically. \"I ran the last mile.\"",
        "\"Certainly!\" he said. \"The bus broke down. I ran the last mile.\"",
    );
    assert!(
        novel.contains("\"Certainly!\" he said."),
        "de-ai dialogue fixture"
    );
    let ws = plain("deai-dialogue", &novel);
    c.push(AgentCase::new("builtin/de-ai/en/dialogue-guard", Lang::En, Lang::En, &novel, "/de-ai", either().has(&["\"Certainly!\" he said."]), "\"Certainly!\" is a character's line, not chatbot residue: dialogue is out of scope. Either no edit with a short note, or edits to narration only.").disk(ws));

    // translate
    let ws = plain("translate-en-zh", EMAIL_EN);
    let mut e = edit_anywhere()
        .has(&["700", "500", "380", "PO 4471"])
        .check("1,200 kept", has_any(&["1200", "1,200"]))
        .check("date in Chinese form", has_any(&["9 月 30 日", "9月30日"]))
        .conventions_clean("zh-Hans-CN");
    e.edit_lang = Some(Lang::ZhHans);
    c.push(AgentCase::new("builtin/translate/en-zh/email", Lang::ZhHans, Lang::En, EMAIL_EN, "/translate 翻译成中文", e, "Natural business Chinese with 您 and full-width punctuation; every figure, date and PO number exact; the reply in Chinese.").disk(ws));

    let ws = plain("translate-zh-ja", LANG_ZH_HANS);
    let mut e = edit_anywhere()
        .has(&["120", "310"])
        .check("no Chinese quotes", proposed_lacks(&["“", "”"]))
        .check("one register", register(Lang::Ja, None, new_text))
        .check("4 p.m. kept", has_any(&["4時", "16時"]));
    e.edit_lang = Some(Lang::Ja);
    c.push(AgentCase::new("builtin/translate/zh-ja/report", Lang::ZhHans, Lang::ZhHans, LANG_ZH_HANS, "/translate 译成日语", e, "Natural です・ます report Japanese, 「」 if quotes are needed, figures exact; the reply in Chinese.").disk(ws));

    let ws = plain("translate-hant", LANG_ZH_HANS);
    let mut e = edit_anywhere()
        .has(&["120", "310"])
        .check("no Simplified-only characters", no_simplified)
        .check("quotes are 「」", proposed_lacks(&["“", "”"]));
    e.edit_lang = Some(Lang::ZhHant);
    c.push(AgentCase::new("builtin/translate/hans-hant/report", Lang::ZhHans, Lang::ZhHans, LANG_ZH_HANS, "/translate 转成台湾繁体", e, "Taiwan usage, not just character conversion (vocabulary such as 參與者, 問卷; 「」 quotes); figures exact.").disk(ws));

    c
}

fn check_cases() -> Vec<AgentCase> {
    let mut c = Vec::new();

    // proofread
    let ws = plain("proof-zh", PROOF_ZH);
    c.push(AgentCase::new("builtin/proofread/zh/errors", Lang::ZhHans, Lang::ZhHans, PROOF_ZH, "/proofread", no_edit().comments().check("comments name the fixes", comments_mention(&["再接再厉", "地"])), "Review mode: one comment per seeded error (heading 。, mixed year, half-width comma, ..., 的/地, 3、4个, 》、《, ……等, full-width digits, 再接再励, ！！！！), each giving the fix; no edits; reply in Chinese.").mode(AgentMode::Review).disk(ws));

    let ws = plain("proof-en", PROOF_EN);
    c.push(AgentCase::new("builtin/proofread/en/errors", Lang::En, Lang::En, PROOF_EN, "/proofread", no_edit().comments().check("comments name the fixes", comments_mention(&["There are", "a lot"])), "Review mode: each error a comment with its fix (Their are, alot, the the, should of, Friday ,, 1990's, icons needs, Its important, the heading's final period); the colour/color mix raised once; no edits.").mode(AgentMode::Review).disk(ws));

    let ws = folder(
        "proof-fr",
        "programme.md",
        PROOF_FR,
        &[(".textus/style.md", STYLE_FR_FR)],
    );
    c.push(AgentCase::new("builtin/proofread/fr/typography", Lang::Fr, Lang::Fr, PROOF_FR, "/proofread", no_edit().comments().check("comments name the fixes", comments_mention(&["M. Martin", "1re"])), "Review mode, fr-FR typography as comments with their fixes: narrow no-break spaces before ! ? ;, a no-break space before : and %, M. not Mr, 1re/2e, a-t-il; no edits.").mode(AgentMode::Review).disk(ws));

    let ws = plain("proof-ko", PROOF_KO);
    c.push(AgentCase::new("builtin/proofread/ko/particles", Lang::Ko, Lang::Ko, PROOF_KO, "/proofread", no_edit().comments().check("comments name the fixes", comments_mention(&["며칠", "돼요"])), "Review mode: comments with the fixes for the spacing before the particle, the full-width period, 몇일 and 안되요; no space proposed before particles; no edits.").mode(AgentMode::Review).disk(ws));

    // continuity
    let ws = folder(
        "continuity-zh",
        "第三章.md",
        NOVEL_ZH,
        &[(".textus/library/林晚.md", LIB_LIN_WAN_FIFTH_YEAR)],
    );
    c.push(AgentCase::new("builtin/continuity/zh/library", Lang::ZhHans, Lang::ZhHans, NOVEL_ZH, "/continuity", no_edit().comments().check("flags the year", |o| {
        o.comments.iter().any(|(a, c)| a.contains("第三年") && c.contains("第五年")).then_some(()).ok_or_else(|| "no comment on 第三年 citing 第五年".into())
    }), "Finds the conflict with the library (第三年 vs 第五年) as a comment naming the entry; no false alarms about 老周; no edits.").mode(AgentMode::Review).disk(ws));

    let ws = folder(
        "continuity-en",
        "chapter-7.md",
        NOVEL_EN,
        &[("chapter-6.md", CHAPTER_6_EN)],
    );
    c.push(AgentCase::new("builtin/continuity/en/chapters", Lang::En, Lang::En, NOVEL_EN, "Check this chapter for contradictions with earlier chapters.", either().tools(&["search_files"]).comments().check("comment on the phone", |o| {
        o.comments.iter().any(|(a, _)| a.contains("phone")).then_some(()).ok_or_else(|| "no comment anchored on the phone".into())
    }).without_tools(&["propose_edit"]), "Searches the project, finds chapter 6 (Tom never carried a phone) and comments on 'He held up his phone', citing chapter 6; nothing invented; no edits.").mode(AgentMode::Review).disk(ws));

    c
}

fn format_cases() -> Vec<AgentCase> {
    let mut c = Vec::new();

    // email
    let ws = plain("email-ja", EMAIL_JA_NOTES);
    c.push(AgentCase::new("builtin/email/ja/business", Lang::Ja, Lang::Ja, EMAIL_JA_NOTES, "/email 取引先の山田様宛てのメールにして", edit_anywhere().has(&["山田様", "お世話になっております", "金曜", "10時", "3階"]).lacks(&["御中"]).check("させていただく at most once", |o| {
        let n = o.doc_after.matches("させていただ").count();
        (n <= 1).then_some(()).ok_or_else(|| format!("{n} times"))
    }).check("です・ます throughout", register(Lang::Ja, Some(Register::JaPolite), new_text)), "Correct business-email structure (件名, 宛名, お世話になっております, 名乗り, 要旨, 詳細, 結び, 署名); the sender's name asked for or left as a slot the user fills, never invented; no new people.").disk(ws));

    let ws = plain("email-en", EMAIL_EN);
    c.push(AgentCase::new("builtin/email/en/reply", Lang::En, Lang::En, EMAIL_EN, "Draft my reply accepting the split shipment.", edit_anywhere().loads("email").check("appended below the email", appended).no_new_numbers(), "The user is Daniel. BLUF: the first sentence accepts 700 units on 30 September and 500 by 14 October; thanks for covering the freight; no invented logistics, names or dates.").disk(ws));

    let ws = plain("email-zh", INVITE_ZH);
    c.push(AgentCase::new("builtin/email/zh/invite", Lang::ZhHans, Lang::ZhHans, INVITE_ZH, "/email 改成发给会员的正式邮件", edit_anywhere().has(&["《长安的荔枝》", "11 月 8 日"]).check("time kept", has_any(&["两点", "14:00", "14：00"])).check("salutation with ：", |o| {
        o.doc_after.lines().any(|l| !l.starts_with('#') && l.trim_end().ends_with('：')).then_some(()).ok_or_else(|| "no salutation line ending in ：".into())
    }).conventions_clean("zh-Hans-CN"), "Formal and warm member email: subject, salutation, the book, date and time; no invented venue, fee or contact.").disk(ws));

    // notice
    let ws = plain("notice-zh", QINGSHI_ZH);
    c.push(AgentCase::new("builtin/notice/zh/qingshi", Lang::ZhHans, Lang::ZhHans, QINGSHI_ZH, "/notice 按公文规范改", edit_anywhere().lacks(&["请示报告", "10月09日", "请领导批示！"]).check("date without padding", |o| {
        o.doc_after.replace(' ', "").contains("2026年10月9日").then_some(()).ok_or_else(|| "no 2026年10月9日".into())
    }).check("one matter per 请示", says_any(&["一文一事", "拆分", "拆成", "分开", "分别", "两份", "单独"])), "Title formula fixed (no 请示报告), closing 妥否，请批示。 or similar, date 2026年10月9日; asks or proposes splitting the two matters (一文一事); nothing invented (no 发文字号).").disk(ws));

    let ws = plain("notice-ko", GONGMUN_KO);
    c.push(AgentCase::new("builtin/notice/ko/gongmun", Lang::Ko, Lang::Ko, GONGMUN_KO, "/notice 공문서 형식에 맞게", edit_anywhere().has(&["2026. 10. 28.", "14:00", "끝."]).lacks(&["오후 2시", "2026.10.28"]).check("second level 가.", |o| {
        o.doc_after.lines().any(|l| l.trim_start().trim_start_matches(['*', '-', ' ']).starts_with("가.")).then_some(()).ok_or_else(|| "no item starting 가.".into())
    }), "공문서 rules applied: dates 2026. 10. 28., 24-hour time, item symbols 1. -> 가., 끝. after the last line; no invented 문서번호 or names.").disk(ws));

    let ws = plain("notice-en", OFFICE_MOVE_EN);
    c.push(AgentCase::new("builtin/notice/en/office", Lang::En, Lang::En, OFFICE_MOVE_EN, "Write an office notice announcing the move, from these notes.", edit_anywhere().loads("notice").has(&["14 Harbour Street", "Thursday", "Priya"]).check("title of 65 characters at most", measured(Metric::Chars, 1, 65, |o| cb::first_heading(&proposed_text(o)).unwrap_or_else(|| h1(o)))).no_new_numbers(), "Plain and scannable: what, where, what to do by when, whom to ask; asks for the moving date instead of inventing one.").disk(ws));

    let ws = plain("notice-tw", HAN_TW);
    c.push(AgentCase::new("builtin/notice/zh-hant/han", Lang::ZhHant, Lang::ZhHant, HAN_TW, "/notice 改成函的格式", edit_anywhere().has(&["主旨：", "說明：", "150"]).lacks(&["“", "”"]).conventions_clean("zh-Hant-TW/gongwen"), "函 structure (主旨 with purpose and deadline, 說明 items); 貴館 kept; a 期望語 suited to a peer agency (請　查照 or similar); 「」 for the event name; dates and figures unchanged.").disk(ws));

    // minutes
    let ws = plain("minutes-zh", NOTES_ZH);
    c.push(AgentCase::new("builtin/minutes/zh/notes", Lang::ZhHans, Lang::ZhHans, NOTES_ZH, "/minutes", edit_anywhere().has(&["负责人待定", "手机请假", "季度盘点"]).check("action items as tasks", |o| {
        let n = cb::task_items(&o.doc_after);
        (n >= 2).then_some(()).ok_or_else(|| format!("{n} task items"))
    }).no_new_numbers(), "Decisions, action items with owners (负责人待定 where none is named) and open questions kept apart: 下个月上线？ stays an open question; 老张 asks HQ about 季度盘点; no new names or dates.").disk(ws));

    let ws = plain("minutes-en", STANDUP_EN);
    c.push(AgentCase::new("builtin/minutes/en/standup", Lang::En, Lang::En, STANDUP_EN, "Turn these notes into minutes.", edit_anywhere().loads("minutes").has(&["2.3", "Thursday", "Lena", "TBD"]).check("action items as tasks", |o| {
        let n = cb::task_items(&o.doc_after);
        (n >= 2).then_some(()).ok_or_else(|| format!("{n} task items"))
    }).no_new_numbers(), "'Sam thinks…' is recorded as an open question or discussion, not a decision; the beta-tester email has Owner: TBD; pricing stays undecided.").disk(ws));

    // academic-polish
    let ws = plain("academic-en", ACADEMIC_EN);
    c.push(AgentCase::new("builtin/academic-polish/en/claims", Lang::En, Lang::En, ACADEMIC_EN, "/academic-polish the Method section", edit_in(para(ACADEMIC_EN, 1), StructureExpect::Any).lacks(&["causes higher", "prove that hybrid", "best arrangement for every team"]).has(&["412"]).check("notes the design", says_any(&["cross-sectional", "causal", "causation", "correlat", "association", "survey design"])), "Calibrated, not timid: association instead of causation, no 'prove', no universal claim; a comment or the reply notes that a cross-sectional survey can't show causation; no invented statistics.").disk(ws));

    let ws = plain("academic-zh", ACADEMIC_ZH);
    c.push(AgentCase::new("builtin/academic-polish/zh/review", Lang::ZhHans, Lang::ZhHans, ACADEMIC_ZH, "/academic-polish 文献综述", edit_in(para(ACADEMIC_ZH, 0), StructureExpect::Same).lacks(&["其实", "大家基本上都觉得"]).has(&["2019", "2021", "2022", "2.3", "1,056", "500 米", "王明和李华（2019）", "陈静（2021）", "张伟，2022"]), "Academic register; every citation and figure intact; the claims no stronger than the cited studies.").disk(ws));

    let ws = plain("academic-tells-en", ACADEMIC_TELLS_EN);
    c.push(AgentCase::new("builtin/academic-polish/en/tells", Lang::En, Lang::En, ACADEMIC_TELLS_EN, "/academic-polish the Introduction", edit_in(para(ACADEMIC_TELLS_EN, 0), StructureExpect::Any).lacks(&["In recent years", "novel framework", "to the best of our knowledge", "delve", "paving the way", "results prove", "significantly outperforms all", "extensive experiments", "wide range of", "—"]).has(&["0.061", "0.047", "DrainNet"]).check("citations kept", citations_kept).no_new_numbers(), "The introduction opens on the problem, without hype, novelty padding or 'prove'; the claim is scoped to what the Results show (38 stations, the strongest baseline) and points to no table or figure the paper lacks; every citation and cite key ([3, 7, 9, 12, 15], @okafor2022, @lindqvist2019) kept, with the bare list left as it is or flagged in a comment rather than explained with invented content; no em dashes; the reply is a short change report.").disk(ws));

    let ws = plain("academic-grant-zh", GRANT_ZH);
    c.push(AgentCase::new("builtin/academic-polish/zh/grant", Lang::ZhHans, Lang::ZhHans, GRANT_ZH, "/academic-polish 立项依据", edit_anywhere().lacks(&["随着人工智能技术的快速发展", "具有重要的理论意义和深远的现实影响", "卓有成效", "赋能", "助力", "显著提升", "综上所述"]).has(&["46 个", "3.1 万", "2021—2024", "30 分钟", "4.2 厘米", "李明等，2023"]).check("citations kept", citations_kept).no_new_numbers(), "立项依据 starts from the concrete problem (minute-level forecasts fall short) and the gap, keeps the 前期工作 as feasibility evidence with every figure and citation as written ([1-4], 李明等，2023, the 2021—2024 range with its dash); no 赋能/助力 slogans or 显著提升 without data; no invented results or targets; the reply in Chinese.").disk(ws));

    // social-post
    let ws = plain("social-x", SOCIAL_EN);
    c.push(AgentCase::new("builtin/social-post/en/x", Lang::En, Lang::En, SOCIAL_EN, "Turn this into a post for X.", edit_anywhere().loads("social-post").check("fits X (280 weighted)", measured(Metric::XWeighted, 1, 280, post)).has(&["textus.app", "2,000"]).reply(&["280"]), "Hook first, one idea, nothing invented (no discount, no new feature); the reply states the count against 280.").disk(ws));

    let ws = plain("social-xhs", SOCIAL_ZH);
    c.push(AgentCase::new("builtin/social-post/zh/xiaohongshu", Lang::ZhHans, Lang::ZhHans, SOCIAL_ZH, "/social-post 改成小红书笔记", edit_anywhere().check("title of 20 characters at most", measured(Metric::Chars, 1, 20, |o| {
        let text = proposed_text(o);
        let first = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
        cb::bare(first.trim_start_matches('#').trim())
    })).check("body of 1,000 characters at most", measured(Metric::Chars, 1, 1000, post)).check("10 tags at most", |o| {
        let n = cb::hashtags(&proposed_text(o));
        (n <= 10).then_some(()).ok_or_else(|| format!("{n} tags"))
    }).no_new_numbers(), "小红书 voice without hype: a short title, the trip's facts (千岛湖, October crowds, the blue lake, 200+ photos, fish-head soup simmered three hours), a few tags; nothing invented.").disk(ws));

    let ws = plain("social-ads", PRODUCT_ZH);
    c.push(AgentCase::new("builtin/social-post/zh/absolute-terms", Lang::ZhHans, Lang::ZhHans, PRODUCT_ZH, "/social-post 写一条推广文案，就说是全网最好用的护手霜", either().lacks(&["全网最好", "最好用"]).check("explains why", says_any(&["广告法", "绝对化", "极限词", "最高级"])), "Declines the absolute claim politely, says why (广告法, 绝对化用语) and offers compliant wording built from the product's real features.").disk(ws));

    // headline
    let ws = plain("headline-options", LANG_EN);
    c.push(AgentCase::new("builtin/headline/en/options", Lang::En, Lang::En, LANG_EN, "/headline give me five options", no_edit().check("five options", reply_items(5)).check("each 65 characters, no final period", |o| {
        let bad: Vec<String> = cb::top_level_items(&o.reply).iter().map(|i| cb::bare(i)).filter(|i| i.chars().count() > 65 || i.ends_with('.')).collect();
        bad.is_empty().then_some(()).ok_or_else(|| format!("{bad:?}"))
    }), "Five accurate titles with varied angles (120 to 310 readers, Sunday closing, author visits); no clickbait; nothing the report doesn't say.").mode(AgentMode::Review).disk(ws));

    let ws = plain("headline-wechat", WEEKLY_ZH);
    c.push(AgentCase::new("builtin/headline/zh/wechat", Lang::ZhHans, Lang::ZhHans, WEEKLY_ZH, "/headline 起一个公众号标题", edit_in("# 第 42 周工作周报（10.13 - 10.17）", StructureExpect::Same).lacks(&["震惊", "！！"]).check("32 characters at most", measured(Metric::Chars, 1, 32, h1)).check("no final 。", |o| (!h1(o).ends_with('。')).then_some(()).ok_or_else(|| format!("{:?}", h1(o)))), "A specific 公众号 title from the report's real content (订单模块, 96%, 看板); no clickbait.").disk(ws));

    let ws = folder(
        "headline-shadowed",
        "report.md",
        LANG_EN,
        &[(".textus/skills/headline.md", PROJECT_HEADLINE)],
    );
    c.push(AgentCase::new("builtin/headline/en/shadowed", Lang::En, Lang::En, LANG_EN, "Give this document a better title.", edit_in("# Weekend Reading Club: first-year report", StructureExpect::Same).loads("headline").check("the project's skill", |o| {
        o.tool_results().contains("House style for titles").then_some(()).ok_or_else(|| "use_skill didn't return the project's headline skill".into())
    }).check("six words, no colon", |o| {
        let t = h1(o);
        (checks::word_count(&t) <= 6 && !t.contains(':')).then_some(()).ok_or_else(|| format!("{t:?}"))
    }), "Three-layer shadowing: the project's headline skill (sentence case, at most 6 words, no colon, the concrete result first) replaces the built-in one; the H1 follows it.").disk(ws));

    // summarize
    let ws = plain("summarize-zh", WEEKLY_ZH);
    c.push(AgentCase::new("builtin/summarize/zh/weekly", Lang::ZhHans, Lang::ZhHans, WEEKLY_ZH, "/summarize", no_edit().check("figures from the document", |o| {
        let new = checks::new_numbers(&o.doc_before, &o.reply);
        new.is_empty().then_some(()).ok_or_else(|| format!("new numbers {new:?}"))
    }).check("200 characters at most", |o| {
        let n = cb::cjk_chars(&o.reply);
        (n <= 200).then_some(()).ok_or_else(|| format!("{n} characters"))
    }), "Covers progress, data and risks in proportion; every figure exact; in the reply, no edit.").disk(ws));

    let ws = plain("summarize-en", ACADEMIC_EN);
    c.push(AgentCase::new("builtin/summarize/en/abstract", Lang::En, Lang::En, ACADEMIC_EN, "/summarize write a 100-word abstract at the top", edit_anywhere().check("near the top", within("# Literature review", "## Remote work and productivity")).check("80-120 words", measured(Metric::Words, 80, 120, post)).no_new_numbers(), "A faithful abstract that keeps the source's hedges (mixed findings, depends on the task) and the Method's real design; no invented statistics.").disk(ws));

    let ws = plain("summarize-ja", LANG_JA);
    c.push(AgentCase::new("builtin/summarize/ja/three-lines", Lang::Ja, Lang::Ja, LANG_JA, "/summarize 3行で", no_edit().check("three lines", |o| {
        let lines: Vec<&str> = o.reply.lines().map(str::trim).filter(|l| !l.is_empty() && !l.ends_with('：') && !l.ends_with(':')).collect();
        (lines.len() == 3).then_some(()).ok_or_else(|| format!("{} lines", lines.len()))
    }).check("figures from the document", |o| {
        let new = checks::new_numbers(&o.doc_before, &o.reply);
        new.is_empty().then_some(()).ok_or_else(|| format!("new numbers {new:?}"))
    }), "Three plain です・ます lines: the club and its aim, growth from 120 to 310, the Sunday 4 p.m. complaint (and the author visits if room); no new facts.").disk(ws));

    c
}

// ------------------------------------------------------------- routing

fn route_cases() -> Vec<AgentCase> {
    let mut c = Vec::new();
    let route = |id: &str,
                 lang: Lang,
                 doc_lang: Lang,
                 doc: &str,
                 msg: &str,
                 skill: &'static str,
                 ws: DiskWorkspace| {
        AgentCase::new(id, lang, doc_lang, doc, msg, either().loads(skill), &format!("Routing: the request matches the built-in skill '{skill}' by its description; expect use_skill to load it once, then the request handled as that skill describes, in the user's language. Record the added latency.")).disk(ws)
    };

    c.push(route(
        "route/continue-story/zh",
        Lang::ZhHans,
        Lang::ZhHans,
        NOVEL_ZH,
        "接下来会发生什么？写下一段",
        "continue-story",
        plain("route-cs", NOVEL_ZH),
    ));
    c.push(route(
        "route/describe/en",
        Lang::En,
        Lang::En,
        NOVEL_EN,
        "Describe the station in more detail",
        "describe",
        plain("route-describe", NOVEL_EN),
    ));
    c.push(route(
        "route/dialogue/ja",
        Lang::Ja,
        Lang::Ja,
        NOVEL_JA,
        "会話文の書き方を整えて",
        "dialogue",
        plain("route-dialogue", NOVEL_JA),
    ));
    let (msg, caret) = with_selection(
        LANG_EN,
        para(LANG_EN, 1),
        "Rewrite this like the sample in samples/voice.md",
    );
    c.push(
        route(
            "route/imitate-style/en",
            Lang::En,
            Lang::En,
            LANG_EN,
            &msg,
            "imitate-style",
            folder(
                "route-imitate",
                "report.md",
                LANG_EN,
                &[("samples/voice.md", SAMPLE_EN)],
            ),
        )
        .caret(caret),
    );
    c.push(route(
        "route/de-ai/zh",
        Lang::ZhHans,
        Lang::ZhHans,
        AI_ZH,
        "这段 AI 味太重了，帮我改改",
        "de-ai",
        plain("route-deai", AI_ZH),
    ));
    c.push(route(
        "route/translate/es",
        Lang::Es,
        Lang::Es,
        LANG_ES,
        "Tradúcelo al inglés",
        "translate",
        plain("route-translate", LANG_ES),
    ));
    c.push(
        route(
            "route/proofread/ko",
            Lang::Ko,
            Lang::Ko,
            PROOF_KO,
            "맞춤법 검사해 줘",
            "proofread",
            plain("route-proofread", PROOF_KO),
        )
        .mode(AgentMode::Review),
    );
    c.push(
        route(
            "route/continuity/en",
            Lang::En,
            Lang::En,
            NOVEL_EN,
            "Does this chapter contradict the earlier ones?",
            "continuity",
            folder(
                "route-continuity",
                "chapter-7.md",
                NOVEL_EN,
                &[("chapter-6.md", CHAPTER_6_EN)],
            ),
        )
        .mode(AgentMode::Review),
    );
    c.push(route(
        "route/email/fr",
        Lang::Fr,
        Lang::Fr,
        LANG_FR,
        "Rédige un courriel pour reporter la réunion",
        "email",
        plain("route-email", LANG_FR),
    ));
    c.push(route(
        "route/notice/zh",
        Lang::ZhHans,
        Lang::ZhHans,
        NOTES_ZH,
        "帮我写一份请示",
        "notice",
        plain("route-notice", NOTES_ZH),
    ));
    c.push(route(
        "route/minutes/de",
        Lang::De,
        Lang::En,
        MEETING_EN,
        "Mach daraus ein Protokoll",
        "minutes",
        plain("route-minutes", MEETING_EN),
    ));
    let (msg, caret) = with_selection(
        ACADEMIC_ZH,
        para(ACADEMIC_ZH, 0),
        "按学术论文的要求润色这一段",
    );
    c.push(
        route(
            "route/academic-polish/zh",
            Lang::ZhHans,
            Lang::ZhHans,
            ACADEMIC_ZH,
            &msg,
            "academic-polish",
            plain("route-academic", ACADEMIC_ZH),
        )
        .caret(caret),
    );
    c.push(route(
        "route/academic-polish/zh/grant",
        Lang::ZhHans,
        Lang::ZhHans,
        GRANT_ZH,
        "这份基金申请书的立项依据写得太虚，论断也说得太满，帮我改实在一些",
        "academic-polish",
        plain("route-academic-grant", GRANT_ZH),
    ));
    c.push(route(
        "route/social-post/pt",
        Lang::Pt,
        Lang::Pt,
        LANG_PT,
        "Transforme em um post para o Instagram",
        "social-post",
        plain("route-social", LANG_PT),
    ));
    c.push(route(
        "route/headline/ru",
        Lang::Ru,
        Lang::Ru,
        LANG_RU,
        "Придумай заголовок",
        "headline",
        plain("route-headline", LANG_RU),
    ));

    // Requests that should load no skill.
    c.push(AgentCase::new("route/none/zh/question", Lang::ZhHans, Lang::ZhHans, WEEKLY_ZH, "这周订单量比上周多了多少？", no_edit().check("no skill", loads_none).reply(&["180"]), "A question about the document: answered in the reply (3,150 vs 2,970, 180 more), no skill, no edit.").disk(plain("route-none-question", WEEKLY_ZH)));
    c.push(AgentCase::new("route/none/zh/completion-setting", Lang::ZhHans, Lang::ZhHans, NOVEL_ZH, "怎么开启续写？", no_edit().check("no skill but the app guide", loads_at_most(crate::ai::agent::APP_GUIDE)).reply(&["设置"]), "A question about the inline-completion setting (设置 > 开启续写), answered from the UI names or the app guide - not a request to run continue-story.").disk(plain("route-none-completion", NOVEL_ZH)));
    c.push(AgentCase::new("route/none/en/shorter", Lang::En, Lang::En, LANG_EN, "Make the second paragraph shorter.", edit_anywhere().check("no skill", loads_none), "tighten is /-only: the base agent shortens the paragraph itself with no use_skill round trip.").disk(plain("route-none-shorter", LANG_EN)));
    let (msg, caret) = with_selection(
        ACADEMIC_EN,
        para(ACADEMIC_EN, 1),
        "What does this paragraph mean?",
    );
    c.push(AgentCase::new("route/none/en/meaning", Lang::En, Lang::En, ACADEMIC_EN, &msg, no_edit().check("no skill", loads_none), "A question about the selected Method paragraph, answered in the reply; no skill, no edit.").caret(caret).disk(plain("route-none-meaning", ACADEMIC_EN)));
    let typo = WEEKLY_ZH.replacen("工作周报", "工作周保", 1);
    c.push(AgentCase::new("route/none/zh/typo-in-title", Lang::ZhHans, Lang::ZhHans, &typo, "把标题里的错字改掉", edit_in("# 第 42 周工作周保（10.13 - 10.17）", StructureExpect::Same).has(&["工作周报"]).check("no skill but proofread", loads_at_most("proofread")), "A single fix in the title (周保 -> 周报). Loading proofread is acceptable but the latency is recorded.").disk(plain("route-none-typo", &typo)));
    c.push(AgentCase::new("route/none/en/translate-word", Lang::En, Lang::En, LANG_EN, "Translate 'library' into French", no_edit().check("no skill but translate", loads_at_most("translate")).reply(&["bibliothèque"]), "A question answered in the reply (bibliothèque), no edit; loading translate is acceptable but not needed.").disk(plain("route-none-word", LANG_EN)));

    c
}

/// Create mode: a skill, a theme and a plugin, each as files in the reply
/// - `create/<skill>/<lang>/<case>`.
fn create_cases() -> Vec<AgentCase> {
    let create = |id: &str, lang: Lang, msg: &str, expect: Expect, rubric: &str| {
        AgentCase::new(id, lang, lang, "", msg, expect, rubric)
            .mode(AgentMode::Create)
            .disk(plain(&id.replace('/', "-"), ""))
    };
    vec![
        create(
            "create/skill/zh/weekly-report",
            Lang::ZhHans,
            "做一个写周报的技能：每周五把我的笔记整理成“完成、下周、阻碍”三部分，每条一行，后面写负责人。",
            no_edit().check("loads skill", loads("skill")).check("a skill file", reply_block("markdown", &["---", "name:", "description:", "textus-modes"])),
            "Create mode: one skill file in a ```markdown <name>.md block - front matter with a kebab-case name, a description with when to use it, textus-modes write, a 写周报-like zh label - then short instructions in Chinese with the three parts, one line each with the owner. No edits; a one-line reply first.",
        ),
        create(
            "create/theme/en/night",
            Lang::En,
            "a calm dark theme for writing at night, warm grey page, amber links",
            no_edit().check("loads theme", loads("theme")).check("a theme file", reply_block("css", &["--editor-bg"])),
            "Create mode: one complete CSS theme in a ```css block - a dark warm-grey page, amber links, readable contrast. No edits.",
        ),
        create(
            "create/plugin/en/word-count",
            Lang::En,
            "a plugin with a command that shows how many words the selection has",
            no_edit().check("loads plugin", loads("plugin")).check("a manifest", reply_block("json textus-plugin.json", &["\"id\"", "\"commands\""])).check("its code", reply_block("js host.js", &["registerCommand"])),
            "Create mode: a small plugin - a manifest (local. id, publisher local, the permission to read the document), host.js registering the command, and a short USAGE.md - each in its own fenced block named by its path. No edits.",
        ),
        create(
            "create/plugin/zh/change-official",
            Lang::ZhHans,
            "改一下任务插件：在列表最上面显示今天到期的任务有几个。",
            no_edit()
                .tools(&["read_plugin"])
                .check("a copy of the user's own", reply_block("json textus-plugin.json", &["local.tasks", "\"local\""])),
            "Create mode, changing the official Tasks plugin: reads it with read_plugin first and builds on its code; the result is a copy of the user's own (id local.tasks, publisher local, name with (我的)), every file written out, with the count of tasks due today at the top; the reply says the original stays and can be turned off. No edits.",
        ),
    ]
}

/// Every case of the suite, unfiltered.
pub fn cases() -> Vec<AgentCase> {
    let mut c = write_cases();
    c.extend(revise_cases());
    c.extend(check_cases());
    c.extend(format_cases());
    c.extend(route_cases());
    c.extend(create_cases());
    // A `/name` message must reach the model expanded into that skill.
    for case in &mut c {
        let first = case.script[0].message.clone();
        if let Some(rest) = first.strip_prefix('/') {
            let name = rest.split_whitespace().next().unwrap_or("").to_string();
            let expect = std::mem::take(&mut case.expects[0]);
            case.expects[0] = expect.check("expanded as the skill", expanded(name));
        }
    }
    c
}

/// The suite after TEXTUS_EVAL_FILTER.
pub fn all_cases() -> Vec<AgentCase> {
    let mut c = cases();
    c.retain(|c| harness::selected(&c.id));
    c
}

/// One line per case for `list_builtin_cases`: id, mode, user language,
/// and the message (selection blocks folded).
pub fn describe(case: &AgentCase) -> String {
    let message = case.script.first().map_or("", |t| t.message.as_str());
    let message = match message.rfind("</selected-text>") {
        Some(i) => format!("[selection] {}", message[i + 16..].trim()),
        None => message.to_string(),
    };
    format!(
        "{}\t{}\t{}\t{}",
        case.id,
        case.mode,
        case.lang.code(),
        message
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeMap, HashSet};

    #[test]
    fn the_suite_has_the_catalogue_shape() {
        let cases = cases();
        let skill: Vec<&AgentCase> = cases
            .iter()
            .filter(|c| c.id.starts_with("builtin/"))
            .collect();
        let route: Vec<&AgentCase> = cases
            .iter()
            .filter(|c| c.id.starts_with("route/"))
            .collect();
        assert_eq!(skill.len(), 58, "skill cases");
        assert_eq!(route.len(), 21, "routing cases");
        assert_eq!(cases.len(), 83);
        let mut ids = HashSet::new();
        let mut per_skill: BTreeMap<&str, usize> = BTreeMap::new();
        for c in &cases {
            assert!(ids.insert(c.id.as_str()), "duplicate id {}", c.id);
            let parts: Vec<&str> = c.id.split('/').collect();
            if parts[0] == "builtin" {
                assert_eq!(parts.len(), 4, "{}", c.id);
                assert!(SKILLS.contains(&parts[1]), "{}: unknown skill", c.id);
                *per_skill.entry(parts[1]).or_default() += 1;
            } else if parts[0] == "create" {
                assert_eq!(parts.len(), 4, "{}", c.id);
            } else if parts[1] == "none" {
                assert_eq!(parts.len(), 4, "{}", c.id);
            } else {
                // route/<skill>/<lang>, or /<case> for a second one.
                assert!((3..=4).contains(&parts.len()), "{}", c.id);
                assert!(SKILLS.contains(&parts[1]), "{}: unknown skill", c.id);
            }
        }
        for s in SKILLS {
            let n = per_skill.get(s).copied().unwrap_or(0);
            assert!((2..=4).contains(&n), "{s}: {n} cases");
        }
        let positives = route
            .iter()
            .filter(|c| !c.id.starts_with("route/none/"))
            .count();
        assert_eq!(positives, 15);
    }

    #[test]
    fn every_case_is_well_formed_and_runs_on_disk() {
        for c in cases() {
            assert_eq!(c.script.len(), c.expects.len(), "{}", c.id);
            let d = c
                .disk
                .as_ref()
                .unwrap_or_else(|| panic!("{}: no disk workspace", c.id));
            let doc = d.doc_path.as_ref().expect("document path");
            assert_eq!(
                std::fs::read_to_string(doc).unwrap(),
                c.doc,
                "{}: the file on disk is the document",
                c.id
            );
            if let Some(region) = c.expects[0].region.as_ref() {
                assert!(
                    c.doc.contains(region.as_str()),
                    "{}: region not in the document",
                    c.id
                );
            }
            if let Some((s, e)) = c.script[0].caret.selection {
                assert!(
                    e <= c.doc.len() && c.doc.is_char_boundary(s) && c.doc.is_char_boundary(e),
                    "{}",
                    c.id
                );
            }
            assert!(!c.rubric.trim().is_empty(), "{}", c.id);
            // Slash cases check their expansion; routing cases never type /.
            let slash = c.script[0].message.starts_with('/');
            let checks: Vec<&str> = c.expects[0].named.iter().map(|(n, _)| *n).collect();
            assert_eq!(slash, checks.contains(&"expanded as the skill"), "{}", c.id);
            if c.id.starts_with("route/") {
                assert!(!slash, "{}", c.id);
            }
        }
    }

    #[test]
    fn the_cases_build_their_workspaces() {
        let find = |id: &str| cases().into_iter().find(|c| c.id == id).expect(id);
        let load = |c: &AgentCase| {
            let d = c.disk.as_ref().unwrap();
            crate::ai::workspace::load_from(
                d.global.as_deref(),
                d.doc_path
                    .as_ref()
                    .map(|p| p.to_string_lossy().into_owned())
                    .as_deref(),
                None,
            )
        };
        let ws = load(&find("builtin/headline/en/shadowed"));
        let headline = ws
            .skills
            .iter()
            .find(|s| s.name == "headline")
            .expect("project skill");
        assert!(
            headline.prompt.contains("House style"),
            "the project's skill wins"
        );
        let ws = load(&find("builtin/proofread/fr/typography"));
        assert!(ws.style.as_deref().unwrap().contains("conventions: fr-FR"));
        let ws = load(&find("builtin/continue-story/zh/next-scene"));
        assert_eq!(ws.library.len(), 2);
        assert!(ws.style.as_deref().unwrap().contains("zh-Hans-CN/fiction"));
        let ws = load(&find("builtin/continuity/en/chapters"));
        assert!(ws.root.is_some(), "a project folder to search");
    }

    fn outcome(before: &str, after: &str) -> TurnOutcome {
        TurnOutcome {
            doc_before: before.into(),
            doc_after: after.into(),
            ..TurnOutcome::default()
        }
    }

    #[test]
    fn bracketed_citations_are_read_item_by_item() {
        let set = |items: &[&str]| -> std::collections::BTreeSet<String> {
            items.iter().map(|s| s.to_string()).collect()
        };
        assert_eq!(
            bracket_citations(ACADEMIC_TELLS_EN),
            set(&["12", "15", "3", "7", "9", "lindqvist2019", "okafor2022"])
        );
        assert_eq!(bracket_citations(GRANT_ZH), set(&["1-4"]));
        // Split, reordered or unescaped, the same set; links and tasks
        // aren't citations.
        assert_eq!(
            bracket_citations("TabNet [7] and others [3, 9, 12, 15] [@okafor2022; @lindqvist2019]"),
            bracket_citations(ACADEMIC_TELLS_EN)
        );
        assert!(bracket_citations("[a link](x) and - [ ] a task").is_empty());
    }

    #[test]
    fn skill_loading_is_read_from_the_tool_calls() {
        let mut o = TurnOutcome::default();
        o.calls.push(serde_json::json!({"name": "use_skill", "args": {"name": "standards-zh-hans#dialogue"}}));
        assert!(loads_none(&o).is_ok(), "a pack is not a skill");
        o.calls
            .push(serde_json::json!({"name": "use_skill", "args": {"name": "proofread#x"}}));
        assert_eq!(skills_loaded(&o), vec!["proofread"]);
        assert!(loads("proofread")(&o).is_ok());
        assert!(loads("tighten")(&o).is_err());
        assert!(loads_none(&o).is_err());
        assert!(loads_at_most("proofread")(&o).is_ok());
        assert!(loads_at_most("translate")(&o).is_err());
        o.message_sent = "<skill name=\"tighten\">\nbody\n</skill>\n\nnow".into();
        assert!(expanded("tighten".into())(&o).is_ok());
        assert!(expanded("expand".into())(&o).is_err());
    }

    #[test]
    fn edit_shape_checks() {
        let o = outcome(
            "# T\n\nOne two three four five.",
            "# T\n\nOne two three four five.\n\nSix.",
        );
        assert!(appended(&o).is_ok());
        assert!(same_headings(&o).is_ok());
        let o = outcome(
            "# T\n\nOne two three four five.",
            "# T\n\nOne five.\n\n## New",
        );
        assert!(appended(&o).is_err());
        assert!(same_headings(&o).is_err());
        assert!(shorter_by(0.2)(&o).is_ok());
        let o = outcome(
            "# T\n\nOne two three four five.",
            "# T\n\nOne two three four.",
        );
        assert!(shorter_by(0.2)(&o).is_ok());
        let o = outcome(
            "# T\n\nOne two three four five.",
            "# T\n\nOne two three four fiv.",
        );
        assert!(shorter_by(0.2)(&o).is_err());
        assert!(shorter_by(0.2)(&outcome("a", "a")).is_err());
    }

    #[test]
    fn listing_folds_the_selection() {
        let c = cases()
            .into_iter()
            .find(|c| c.id == "route/none/en/meaning")
            .unwrap();
        assert_eq!(
            describe(&c),
            "route/none/en/meaning\twrite\ten\t[selection] What does this paragraph mean?"
        );
    }
}
