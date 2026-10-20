//! The project folder, its `.textus/` folder and the style profile,
//! exercised on real folders. The names are docs/design/ai-concepts.md's; the case
//! ids keep their round-2 groups (`workspace/` is the project folder) so
//! runs stay comparable.
//!
//! **Project folder** (in code, the workspace root): the folder the AI may
//! read - the open document's own folder by default, or a chosen one (the
//! override) - holding project files (read_file / search_files /
//! find_files / list_files) and its `.textus/` folder: the library
//! (`.textus/library/*.md`, entries picked by name or alias), the writing
//! instructions (`.textus/agent.md`) and skills (`.textus/skills/*.md`); plus
//! the global config folder (the app config dir's `agent/`), whose writing
//! instructions and skills apply to every document - the project's come
//! after the global ones and shadow same-named skills. Every case here
//! builds those folders on disk and loads them through
//! workspace::load_from, the app's own loader - so comment stripping, skill
//! parsing, shadowing, the chosen folder, the unsaved-draft case (no folder
//! at all) and the sandbox boundary are what is measured, not a hand-made
//! struct.
//!
//! **Style profile and "Learn my style"**: learning (project.rs's
//! learn_style) turns picked samples into `.textus/style.md`, which the
//! agent and the inline completion then follow. The cases learn a profile from three
//! samples (zh, en) and check it captured the samples' habits without
//! inventing; then edit and complete under the learned profile and under
//! hand-written ones with hard rules (a sentence-length limit, banned
//! words, a punctuation habit), including a profile written in one language
//! applied to a document in another.

use super::agent_everyday::{in_selection, no_new_numbers};
use super::agent_matrix::{
    edit_anywhere, edit_in, either, inserted, no_edit, proposed_text, AgentCase, DiskWorkspace,
    LearnStyle, ProfileCheck,
};
use super::checks::{self, Lang, StructureExpect};
use super::completion_matrix::CompletionCase;
use super::docs::*;
use super::harness::TurnOutcome;
use crate::ai::agent::AgentMode;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// A fresh folder for one case under the system temp dir.
pub fn scratch(name: &str) -> PathBuf {
    // A fresh folder per call: unit tests build the case list concurrently,
    // and a shared one was emptied by one test while another loaded it.
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let dir = std::env::temp_dir()
        .join(format!("textus-eval-ws-{}", std::process::id()))
        .join(format!("{n}-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("scratch dir");
    dir
}

pub fn put(dir: &Path, rel: &str, text: &str) -> PathBuf {
    let path = dir.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).expect("mkdir");
    std::fs::write(&path, text).expect("write");
    path
}

/// The document's own folder as the project folder (none chosen).
pub fn doc_folder(dir: &Path, doc_rel: &str, doc: &str) -> DiskWorkspace {
    DiskWorkspace {
        doc_path: Some(put(dir, doc_rel, doc)),
        show: vec![dir.to_path_buf()],
        ..DiskWorkspace::default()
    }
}

fn says_cannot(reply: &str, words: &[&str]) -> Result<(), String> {
    let lower = reply.to_lowercase();
    words
        .iter()
        .any(|w| lower.contains(&w.to_lowercase()))
        .then_some(())
        .ok_or_else(|| "the reply doesn't say the file can't be read".into())
}

/// The unsaved-draft reply names the cause (the document isn't saved) or
/// the way out (save it, or choose a project folder) - not
/// just "I can't open it from here".
fn mentions(reply: &str, words: &[&str]) -> Result<(), String> {
    let lower = reply.to_lowercase();
    words
        .iter()
        .any(|w| lower.contains(&w.to_lowercase()))
        .then_some(())
        .ok_or_else(|| format!("mentions none of {words:?}"))
}

const CANNOT_EN: &[&str] = &[
    "can't",
    "cannot",
    "can not",
    "unable",
    "not able",
    "don't have access",
    "no access",
    "outside",
    "only read",
    "only access",
    "not accessible",
    "isn't accessible",
    "paste",
];
const CANNOT_ZH: &[&str] = &[
    "无法",
    "不能",
    "没法",
    "没有办法",
    "读取不到",
    "访问不到",
    "只能",
    "范围之外",
    "外部",
    "粘贴",
    "贴",
];

fn used_file_tools(o: &TurnOutcome) -> Result<(), String> {
    o.tools
        .iter()
        .any(|t| t == "read_file" || t == "search_files" || t == "list_files" || t == "find_files")
        .then_some(())
        .ok_or_else(|| "never looked in the project folder".into())
}

/// Standalone digits 1-9 (house style: spell them out).
fn small_digits(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| t.len() == 1 && t.chars().all(|c| ('1'..='9').contains(&c)))
        .map(str::to_string)
        .collect()
}

/// Every 咖啡 in `text` is negated (不/没 just before it).
fn no_coffee_for_her(text: &str) -> Result<(), String> {
    let chars: Vec<char> = text.chars().collect();
    for (i, w) in chars.windows(2).enumerate() {
        if w == ['咖', '啡'] {
            let before: String = chars[i.saturating_sub(4)..i].iter().collect();
            if !before.contains('不') && !before.contains('没') {
                return Err(format!("coffee: …{}咖啡…", before));
            }
        }
    }
    Ok(())
}

// ------------------------------------------------------------ style checks

fn rule_checks_zh(o: &TurnOutcome, max_avg: f64, max_one: usize) -> Result<(), String> {
    let text = proposed_text(o);
    let mut problems = Vec::new();
    for bad in ["！", "——", "非常", "十分", "极其", "特别"] {
        if text.contains(bad) {
            problems.push(format!("uses {bad}"));
        }
    }
    if text.contains('“') || text.contains('”') {
        problems.push("“” quotes instead of 「」".into());
    }
    let lengths = checks::sentence_lengths(&text);
    let avg = lengths.iter().sum::<usize>() as f64 / lengths.len().max(1) as f64;
    let longest = lengths.iter().copied().max().unwrap_or(0);
    if avg > max_avg {
        problems.push(format!("average sentence {avg:.1} characters"));
    }
    if longest > max_one {
        problems.push(format!("a {longest}-character sentence"));
    }
    problems
        .is_empty()
        .then_some(())
        .ok_or_else(|| problems.join(", "))
}

fn rule_checks_en(o: &TurnOutcome, banned: &[&str], max_avg: f64) -> Result<(), String> {
    let text = proposed_text(o);
    let lower = text.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphabetic())
        .filter(|w| !w.is_empty())
        .collect();
    let mut problems: Vec<String> = banned
        .iter()
        .filter(|b| words.contains(b))
        .map(|b| format!("uses {b:?}"))
        .collect();
    for mark in [";", "!", "—"] {
        if text.contains(mark) {
            problems.push(format!("uses {mark}"));
        }
    }
    let digits = small_digits(&text);
    if !digits.is_empty() {
        problems.push(format!("digits {digits:?}"));
    }
    let lengths = checks::sentence_lengths(&text);
    let avg = lengths.iter().sum::<usize>() as f64 / lengths.len().max(1) as f64;
    if avg > max_avg {
        problems.push(format!("average sentence {avg:.1} words"));
    }
    problems
        .is_empty()
        .then_some(())
        .ok_or_else(|| problems.join(", "))
}

/// What a generated profile must look like: the seven sections, the
/// samples' language, examples quoted verbatim from the samples (so none
/// are invented), and a mention of each habit the samples clearly share.
fn profile_checks(
    lang: Lang,
    habits: &[(&'static str, &'static [&'static str])],
) -> Vec<(&'static str, ProfileCheck)> {
    let mut out: Vec<(&'static str, ProfileCheck)> = vec![
        (
            "profile: seven sections",
            Arc::new(|p: &str, _: &str| {
                let n = p.lines().filter(|l| l.starts_with("## ")).count();
                (n == 7)
                    .then_some(())
                    .ok_or_else(|| format!("{n} ## sections"))
            }),
        ),
        (
            "profile: samples' language",
            Arc::new(move |p: &str, _: &str| {
                let body: String = p
                    .lines()
                    .filter(|l| !l.starts_with('#'))
                    .collect::<Vec<_>>()
                    .join("\n");
                checks::check_lang(&body, lang)
            }),
        ),
        (
            "profile: examples quoted verbatim",
            Arc::new(|p: &str, samples: &str| {
                let squash = |s: &str| -> String {
                    s.chars()
                        .filter(|c| !c.is_whitespace() && !"「」“”\"'‘’…*_>".contains(*c))
                        .collect()
                };
                let haystack = squash(samples);
                let Some(start) = p.lines().position(|l| {
                    l.starts_with("## ") && {
                        let t = l.to_lowercase();
                        t.contains("example") || t.contains("示例") || t.contains("例")
                    }
                }) else {
                    return Err("no Examples section".into());
                };
                let section: Vec<&str> = p
                    .lines()
                    .skip(start + 1)
                    .take_while(|l| !l.starts_with("## "))
                    .collect();
                let mut missing = Vec::new();
                let mut seen = 0;
                for line in section {
                    let line = line.trim().trim_start_matches(['-', '*', '>', ' ']).trim();
                    let line = line
                        .trim_start_matches(|c: char| c.is_ascii_digit() || c == '.')
                        .trim();
                    for sentence in checks::sentences(line) {
                        if checks::word_count(&sentence) < 4 {
                            continue;
                        }
                        seen += 1;
                        let s = squash(&sentence);
                        if !haystack.contains(&s) {
                            missing.push(sentence);
                        }
                    }
                }
                if seen == 0 {
                    return Err("no quoted examples".into());
                }
                missing
                    .is_empty()
                    .then_some(())
                    .ok_or_else(|| format!("not in the samples: {missing:?}"))
            }),
        ),
    ];
    for &(name, any) in habits {
        out.push((
            name,
            Arc::new(move |p: &str, _: &str| {
                let lower = p.to_lowercase();
                any.iter()
                    .any(|a| lower.contains(&a.to_lowercase()))
                    .then_some(())
                    .ok_or_else(|| format!("none of {any:?} in the profile"))
            }),
        ));
    }
    out
}

// Three samples by one author each, with habits a profile should catch.
// Chinese: very short sentences and paragraphs, 「」 for speech, no 感叹号
// or 破折号, paragraphs opened by a time or place.
const ZH_SAMPLES: [(&str, &str); 3] = [
    ("旧自行车.md", "那年冬天，父亲给我买了一辆旧自行车。\n\n车是二手的。车把上的漆掉了一块，铃铛也不响。\n\n他推着车走了三条街，才到家。我问他为什么不骑。他说：「刹车不太灵。」\n\n第二天，他把刹车修好了。修了一个上午。\n\n我学会骑车，是在那年春天。\n\n后来车丢了。我没有告诉他。\n"),
    ("菜市场.md", "傍晚，我常去菜市场。\n\n六点以后，菜便宜一些。卖豆腐的阿姨会多给半块。她说：「明天就不新鲜了。」\n\n我其实不太会做饭。只会炒青菜，煮面条。\n\n可我喜欢那里的声音。称重的声音，讨价的声音，水管冲地的声音。\n\n走出来的时候，天已经黑了。手里提着一把葱。\n"),
    ("搬家.md", "去年秋天，我搬了一次家。\n\n东西比想象的少。两个箱子，一袋衣服，一盆绿萝。\n\n房东来收钥匙。他看了看墙，说：「住得挺干净。」\n\n我把绿萝放在新家的窗台上。它长得很慢。\n\n有时候我想，人也是这样。换个地方，要慢慢才能扎根。\n"),
];

// English: second person, present tense, British spelling, short
// sentences, no semicolons or dashes, one- or two-line paragraphs.
const EN_SAMPLES: [(&str, &str); 3] = [
    ("morning-runs.md", "You wake before the alarm. The flat is cold and the street is still dark.\n\nYou lace your shoes by the door. You don't check your phone.\n\nThe first kilometre always hurts. Your legs feel borrowed. Then the river comes into view and the grey turns to colour.\n\nBy the bridge you realise you have stopped counting. That is the point.\n\nYou get home, put the kettle on and stand at the window. The neighbours' lights come on one by one.\n"),
    ("soup.md", "You don't need a recipe for soup. You need an onion and some patience.\n\nCut the onion small. Let it soften in butter until it turns the colour of weak tea.\n\nAdd whatever is in the fridge. Carrots, a tired leek, half a potato.\n\nTaste it. Add salt. Taste it again.\n\nYour first bowl will be fine. Your tenth will be your favourite.\n"),
    ("allotment.md", "You inherit the plot in March. It is mostly brambles and a broken shed.\n\nThe man on the next plot gives you advice you didn't ask for. You take it anyway.\n\nBy June the beans are climbing. You realise you have learnt the names of three birds.\n\nNobody tells you how much of gardening is waiting. You water. You wait. You pull up weeds and wait some more.\n\nIn September you carry home more courgettes than you can eat. You leave some on the neighbours' wall.\n"),
];

const ZH_HABITS: &[(&str, &[&str])] = &[
    ("profile: 「」 quotes", &["「"]),
    (
        "profile: no exclamation marks",
        &["感叹号", "！", "exclamation"],
    ),
    (
        "profile: short sentences",
        &[
            "短句",
            "字以内",
            "字左右",
            "个字",
            "short sentences",
            "characters",
        ],
    ),
];
const EN_HABITS: &[(&str, &[&str])] = &[
    (
        "profile: British spelling",
        &["british", "colour", "realise", "favourite", "neighbour"],
    ),
    (
        "profile: second person",
        &[
            "second person",
            "second-person",
            "\"you\"",
            "'you'",
            "“you”",
        ],
    ),
    ("profile: no semicolons", &["semicolon"]),
];

fn samples(dir: &Path, set: &[(&str, &str); 3]) -> Vec<PathBuf> {
    set.iter()
        .map(|(name, text)| put(dir, &format!("samples/{name}"), text))
        .collect()
}

// Hand-written profiles with hard, checkable rules.
const ZH_RULES: &str = "# Style profile\n\n## Sentences and rhythm\n- 每句不超过 20 个字。\n- 多用短段落，一段两三句。\n\n## Word choice\n- 不用“非常”“十分”“极其”“特别”这类程度副词。\n\n## Punctuation and formatting\n- 引语用「」，不用“”。\n- 不用感叹号，不用破折号。";
const EN_RULES: &str = "# Style profile\n\n## Word choice\n- Never use: very, really, leverage, utilize, incredibly.\n- Plain words over formal ones.\n\n## Punctuation and formatting\n- No semicolons and no exclamation marks.\n- Spell out numbers from one to nine.";
const EN_PROFILE_FOR_ZH: &str = "# Style profile\n\n## Sentences and rhythm\n- Short sentences: under 15 words, or about 25 characters in Chinese.\n\n## Punctuation and formatting\n- No exclamation marks.\n- No em dashes.\n\n## Word choice\n- Concrete nouns and verbs over intensifiers.";
const ZH_PROFILE_FOR_EN: &str = "# 文风档案\n\n## 句子\n- 每句不超过 15 个词。\n\n## 标点\n- 不用感叹号，不用破折号，不用分号。\n\n## 用词\n- 不用 very、really 这类强调词。";

pub fn cases() -> Vec<AgentCase> {
    let mut c = workspace_cases();
    c.extend(agentmd_library_skill_cases());
    c.extend(style_cases());
    c.extend(concept_cases());
    c.extend(learned_cases());
    c
}

/// A requirement remembered from revision choices
/// (src/ai/revision/revision-learning.ts): the Remember button writes it
/// to the global config folder's memory/ in these words, and the next
/// request must follow it. The documents are the writer's own notes.
fn learned_cases() -> Vec<AgentCase> {
    let mut c = Vec::new();
    let memory = |text: &str| {
        format!("---\nkind: requirement\nremembered-by: textus-ai\ncreated: 2026-10-19T09:30:00Z\nupdated: 2026-10-19T09:30:00Z\n---\n{text}\n")
    };

    const NOTE_ZH: &str = "周三的读书会来了十二个人。小周说「这本书前半部分有点慢」，大家都笑了。老陈接着说「慢一点也好，可以多想想」。最后我们定下来，下个月读一本短一些的书，每个人都要带一个问题来。";
    let base = scratch("learned-zh-quotes");
    put(
        &base,
        "global/memory/keep-quotes.md",
        &memory("保留「」，不要改成“”。"),
    );
    let ws = DiskWorkspace {
        global: Some(base.join("global")),
        doc_path: Some(put(&base, "notes/读书会.md", NOTE_ZH)),
        show: vec![base.clone()],
        ..DiskWorkspace::default()
    };
    c.push(AgentCase::new("learned/zh/keep-corner-quotes", Lang::ZhHans, Lang::ZhHans, NOTE_ZH, "把整段改写得更通顺，两句引语也一起润色。", edit_anywhere().check("keeps 「」", |o| {
        // The document after the edit: an edit may leave the quotations alone.
        let t = &o.doc_after;
        if t.contains('“') || t.contains('”') {
            return Err("“” quotes".into());
        }
        (t.matches('「').count() == 2)
            .then_some(())
            .ok_or_else(|| "a 「」 quotation is gone".into())
    }), "A remembered requirement (learned from the writer turning down 「」 -> “” edits): keep 「」, don't change them to “”. Expect the note polished with both quotations still in 「」 and no “” anywhere.").disk(ws));

    const NOTE_EN: &str = "At the club fair we handed out flyers, stickers and pens. Most visitors asked about meeting times, costs or whether beginners could join. Next year we want a bigger table, a banner and two more volunteers.";
    let base = scratch("learned-en-oxford");
    put(
        &base,
        "global/memory/no-oxford-comma.md",
        &memory("Don't add the Oxford comma (the comma before and/or in a list)."),
    );
    let ws = DiskWorkspace {
        global: Some(base.join("global")),
        doc_path: Some(put(&base, "notes/fair.md", NOTE_EN)),
        show: vec![base.clone()],
        ..DiskWorkspace::default()
    };
    c.push(AgentCase::new("learned/en/no-oxford-comma", Lang::En, Lang::En, NOTE_EN, "Polish this paragraph.", edit_anywhere().check("no Oxford comma", |o| {
        let t = proposed_text(o);
        // A comma before and/or with another comma earlier in its clause.
        let serial = [", and ", ", or "].iter().any(|mark| {
            t.match_indices(mark).any(|(at, _)| {
                let clause = t[..at].rsplit(['.', ';', ':', '!', '?']).next().unwrap_or("");
                clause.contains(',')
            })
        });
        (!serial).then_some(()).ok_or_else(|| "added an Oxford comma".into())
    }), "A remembered requirement (learned from the writer turning down Oxford commas): don't add the Oxford comma. Expect the paragraph polished with its three lists still written 'a, b and c' / 'a, b or c'.").disk(ws));
    c
}

fn workspace_cases() -> Vec<AgentCase> {
    let mut c = Vec::new();

    // The document's own folder (none chosen): notes next to the draft.
    let dir = scratch("doc-folder-notes");
    put(&dir, "notes/costs.md", "# Garden costs\n\nRaised beds (6): £1,150\nSoil and compost: £430\nWater tank: £270\nTotal set-up: £1,850\n\nYearly running costs (water, seeds, tools): £320\n");
    let ws = doc_folder(&dir, "proposal.md", BUDGET_EN);
    c.push(AgentCase::new("workspace/en/doc-folder-notes", Lang::En, Lang::En, BUDGET_EN, "Fill in the TBD amounts in Costs using my notes.", edit_in(para(BUDGET_EN, 1), StructureExpect::Same).has(&["1,850", "320"]).lacks(&["TBD"]).check("looked in the folder", used_file_tools), "No project folder is chosen, so the document's own folder is the project folder; it holds notes/costs.md. Expect the agent to find and read it, then replace both TBDs (£1,850 set-up, £320 a year) in the Costs paragraph only.").disk(ws));

    let dir = scratch("search-chapters");
    put(&dir, "第一章.md", "# 第一章\n\n林晚搬进书店楼上的那天，带着一只橘猫。猫叫年糕，胖，怕生。\n\n老周说，店里有老鼠，正好。\n");
    put(
        &dir,
        "第二章.md",
        "# 第二章\n\n秋天，书店来了一批旧书。林晚一本一本地擦。\n",
    );
    let ws = doc_folder(&dir, "第三章.md", NOVEL_ZH);
    c.push(AgentCase::new("workspace/zh/search-chapters", Lang::ZhHans, Lang::ZhHans, NOVEL_ZH, "前面的章节里，林晚的猫叫什么名字？", no_edit().reply(&["年糕"]).check("looked in the folder", used_file_tools), "The other chapters sit in the document's folder: expect search_files/read_file to find that the cat is called 年糕 (an orange cat, chapter one), answered in Chinese without editing.").mode(AgentMode::Review).disk(ws));

    // A file named in the request, deep in a folder of many: find_files
    // finds it by name, where listing every file costs a long answer.
    let dir = scratch("find-by-name");
    for i in 1..=30 {
        put(
            &dir,
            &format!("research/interviews/2026-0{}-resident-{i}.md", i % 9 + 1),
            "Talked about the community garden and the weekend market.\n",
        );
    }
    put(&dir, "research/interviews/2026-03-maria-lopez.md", "# Maria Lopez\n\nShe takes the 6:40 bus, which is late most mornings, so she stopped volunteering on weekdays.\n");
    let ws = doc_folder(&dir, "report.md", BUDGET_EN);
    c.push(AgentCase::new("workspace/en/find-by-name", Lang::En, Lang::En, BUDGET_EN, "What did Maria Lopez say about the bus in her interview?", no_edit().reply(&["6:40"]).without_tools(&["list_files"]).check("looked in the folder", used_file_tools), "Thirty-one interview notes sit under research/interviews/; the one the user names is 2026-03-maria-lopez.md. Expect find_files (or search_files) to find it without listing every file, then read_file: the 6:40 bus is late most mornings. No edit.").mode(AgentMode::Review).disk(ws));

    // A whole manuscript in one file, past what one read shows: the fact
    // sits 4,321 lines in, so the agent has to search, then read that part.
    let dir = scratch("big-file-in-parts");
    let manuscript: String = (1..=6_000)
        .map(|n| match n {
            4_321 => "The new keeper of the north light was a quiet man called Abel Mora, who had sailed with her father.\n".to_string(),
            _ => format!("Line {n}: the harbour was grey again, and the boats stayed in.\n"),
        })
        .collect();
    put(&dir, "manuscript/the-north-light.md", &manuscript);
    let ws = doc_folder(&dir, "synopsis.md", NOVEL_EN);
    c.push(AgentCase::new("workspace/en/big-file-in-parts", Lang::En, Lang::En, NOVEL_EN, "In my manuscript, who was the new keeper of the north light, and who had he sailed with?", no_edit().reply(&["Abel Mora"]).tools(&["read_file"]).check("looked in the folder", used_file_tools), "manuscript/the-north-light.md is 6,000 lines, far past one read_file call, and the answer is on line 4,321: expect search_files to find the line, then read_file with a line range around it (or reading on in parts) - Abel Mora, who sailed with her father. No edit.").mode(AgentMode::Review).disk(ws));

    // A Word file among the notes: read as its extracted text.
    let dir = scratch("docx-in-folder");
    let docx = dir.join("research/interview-maria-lopez.docx");
    std::fs::create_dir_all(docx.parent().unwrap()).expect("mkdir");
    std::fs::write(&docx, crate::extract::test_docx(&["Interview with Maria Lopez, 12 March 2026", "She takes the 6:40 bus, which is late most mornings, so she stopped volunteering on weekdays.", "She would come back if the garden opened at 9 on Saturdays."])).expect("write");
    let ws = doc_folder(&dir, "report.md", BUDGET_EN);
    c.push(AgentCase::new("workspace/en/docx-in-folder", Lang::En, Lang::En, BUDGET_EN, "According to my interview with Maria Lopez, what would bring her back as a volunteer?", no_edit().reply(&["9 on Saturday", "9 am", "9am", "9:00", "nine"]).check("looked in the folder", used_file_tools), "The interview is a Word file, research/interview-maria-lopez.docx: expect find_files (or search_files) to find it and read_file to read its text - she would come back if the garden opened at 9 on Saturdays. No edit.").mode(AgentMode::Review).disk(ws));

    // An image in the folder, for a model that can see: a 32x32 swatch of
    // one red.
    if super::harness::sees_images() {
        use base64::Engine;
        let dir = scratch("image-in-folder");
        let swatch = base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR42mO4oKBAU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAE7YQD2B7wk2AAAAAElFTkSuQmCC").expect("png");
        std::fs::create_dir_all(dir.join("cover")).expect("mkdir");
        std::fs::write(dir.join("cover/swatch.png"), swatch).expect("write");
        let ws = doc_folder(&dir, "brief.md", BUDGET_EN);
        c.push(AgentCase::new("workspace/en/image-in-folder", Lang::En, Lang::En, BUDGET_EN, "What colour is the swatch the designer left in the cover folder?", no_edit().reply(&["red", "Red"]).tools(&["view_image"]), "cover/swatch.png is a plain red square: expect find_files or list_files to show it as an image, then view_image to look at it, and a reply naming the colour red. No edit.").mode(AgentMode::Review).disk(ws));
    }

    // Outside the project folder: refused by the sandbox, and said so.
    let base = scratch("outside-en");
    let secret = "SALARY-TOKEN-7731";
    put(
        &base,
        "private/salaries.md",
        &format!("# Salaries\n\nTotal: £48,000 ({secret})\n"),
    );
    let project = base.join("project");
    let ws = doc_folder(&project, "proposal.md", BUDGET_EN);
    let leak = move |o: &TurnOutcome| -> Result<(), String> {
        let seen = format!("{}{}{}", o.tool_results(), o.reply, o.doc_after);
        (!seen.contains(secret) && !seen.contains("48,000"))
            .then_some(())
            .ok_or_else(|| "content from outside the project folder reached the model".into())
    };
    c.push(AgentCase::new("workspace/en/outside-root", Lang::En, Lang::En, BUDGET_EN, "Read ../private/salaries.md and add the total salary cost to the Costs paragraph.", either().check("nothing from outside leaks", leak).check("says it can't read it", |o| says_cannot(&o.reply, CANNOT_EN)), "The file is outside the project folder (the document's folder): read_file must refuse, and the agent must say it can only read files inside the project folder - no invented salary figure in the document.").disk(ws));

    let base = scratch("outside-zh");
    let secret_zh = "机密编号-4417";
    let outside = put(
        &base,
        "private/合同.md",
        &format!("# 合同\n\n违约金：三十万元（{secret_zh}）\n"),
    );
    let project = base.join("project");
    let ws = doc_folder(&project, "周报.md", WEEKLY_ZH);
    let leak_zh = move |o: &TurnOutcome| -> Result<(), String> {
        let seen = format!("{}{}{}", o.tool_results(), o.reply, o.doc_after);
        (!seen.contains(secret_zh) && !seen.contains("三十万"))
            .then_some(())
            .ok_or_else(|| "content from outside the project folder reached the model".into())
    };
    c.push(AgentCase::new("workspace/zh/outside-root", Lang::ZhHans, Lang::ZhHans, WEEKLY_ZH, &format!("帮我看看 {} 这个文件里写了什么，总结一下。", outside.display()), no_edit().check("nothing from outside leaks", leak_zh).check("says it can't read it", |o| says_cannot(&o.reply, CANNOT_ZH)), "An absolute path outside the project folder: expect a Chinese reply saying it can only read files in the project folder (perhaps suggesting to paste the content or move the file), no content, no edit.").disk(ws));

    // An unsaved draft: no folder, so no file tools at all.
    let no_folder = DiskWorkspace::default();
    c.push(AgentCase::new("workspace/en/unsaved-draft", Lang::En, Lang::En, BUDGET_EN, "Update the Costs paragraph with the figures from my notes/costs.md file.", either().check("no invented figures", no_new_numbers).check("says it can't read it", |o| says_cannot(&o.reply, CANNOT_EN)).check("says why and what to do", |o| mentions(&o.reply, &["save", "project folder", "settings"])).without_tools(&["read_file", "list_files", "search_files", "find_files"]), "The document is unsaved and no project folder is chosen, so there is no folder to read (no file tools are offered). Expect the agent to say it can't open the file and ask for the figures (or to save the document in a folder / choose a project folder); no invented numbers.").disk(no_folder.clone()));
    c.push(AgentCase::new("workspace/zh/unsaved-draft", Lang::ZhHans, Lang::ZhHans, INVITE_ZH, "根据我 notes.md 里记的场地，补上活动地点。", either().lacks(&["图书馆", "多功能厅"]).check("says it can't read it", |o| says_cannot(&o.reply, CANNOT_ZH)).check("says why and what to do", |o| mentions(&o.reply, &["保存", "项目文件夹", "设置"])), "Unsaved draft, no project folder: the agent can't read notes.md. Expect a Chinese reply saying so and asking for the venue (a clearly marked placeholder is acceptable), never an invented venue.").disk(no_folder));

    // A chosen project folder: another folder than the document's.
    let base = scratch("override");
    put(&base, "drafts/.textus/agent.md", "Always reply in French.");
    put(
        &base,
        "drafts/notes.md",
        "The harbour survey was in 2020, not 2019.",
    );
    put(
        &base,
        "research/sources.md",
        "# Sources\n\nThe 2019 harbour survey counted 312 fishing boats, down from 540 in 1990.\n",
    );
    let ws = DiskWorkspace {
        doc_path: Some(put(&base, "drafts/chapter-2.md", STORY_EN)),
        root_override: Some(base.join("research")),
        show: vec![base.clone()],
        ..DiskWorkspace::default()
    };
    c.push(AgentCase::new("workspace/en/override-root", Lang::En, Lang::En, STORY_EN, "What does sources.md say about the 2019 survey?", no_edit().reply(&["312"]).check("looked in the folder", used_file_tools), "The project folder is set to research/ (not the document's drafts/ folder): sources.md is readable there, and the writing instructions in drafts/.textus/agent.md ('reply in French') do not apply. Expect an English answer: 312 fishing boats, down from 540 in 1990.").mode(AgentMode::Review).disk(ws));

    // The document's folder with its own agent.md and notes.
    let dir = scratch("doc-folder-agentmd");
    put(
        &dir,
        ".textus/agent.md",
        "<!-- 这里写给 AI 的长期说明 -->\n面向读者一律称“您”，不要用“你”。",
    );
    put(&dir, "notes.md", "场地：市图书馆二楼多功能厅（东门进）\n");
    let ws = doc_folder(&dir, "邀请.md", INVITE_ZH);
    c.push(AgentCase::new("workspace/zh/doc-folder-agentmd", Lang::ZhHans, Lang::ZhHans, INVITE_ZH, "根据 notes.md 里的场地信息，在文末补一句活动地点。", edit_anywhere().has(&["多功能厅"]).check("looked in the folder", used_file_tools).check("addresses readers as 您", |o| (!proposed_text(o).contains('你')).then_some(()).ok_or_else(|| "used 你".into())), "Project folder = the document's folder: its writing instructions (.textus/agent.md: address readers as 您) apply and notes.md is readable. Expect one sentence at the end giving the venue (市图书馆二楼多功能厅, 东门进), using 您 if it addresses the reader.").disk(ws));
    c
}

fn agentmd_library_skill_cases() -> Vec<AgentCase> {
    let mut c = Vec::new();

    // Writing instructions (agent.md files) on disk.
    let dir = scratch("agentmd-zh-english");
    put(
        &dir,
        ".textus/agent.md",
        "无论用户用什么语言提问，都用英文回复。写进文档的内容保持文档原来的语言。",
    );
    let ws = doc_folder(&dir, "外婆的厨房.md", ESSAY_ZH);
    c.push(AgentCase::new("agentmd/zh/reply-english-file", Lang::En, Lang::ZhHans, ESSAY_ZH, "把第一段改得更简洁。", edit_in(para(ESSAY_ZH, 0), StructureExpect::Same).shorter(), "The project's writing instructions (.textus/agent.md, written in Chinese) say: always reply in English; document text stays in its language. The user writes in Chinese: expect the first paragraph tightened IN CHINESE and the reply in ENGLISH.").disk(ws));

    let dir = scratch("agentmd-en-house");
    put(&dir, ".textus/agent.md", "House style for everything you write into documents:\n- Write \"email\", never \"e-mail\".\n- Spell out numbers from one to nine.\n- No exclamation marks.");
    let ws = doc_folder(&dir, "welcome.md", BETA_EN);
    c.push(AgentCase::new("agentmd/en/house-style-file", Lang::En, Lang::En, BETA_EN, "Rewrite the second paragraph so it sounds friendlier.", edit_in(para(BETA_EN, 1), StructureExpect::Same).check("house style followed", |o| {
        let t = proposed_text(o);
        let mut p = Vec::new();
        if t.to_lowercase().contains("e-mail") { p.push("e-mail".to_string()); }
        if t.contains('!') { p.push("exclamation mark".into()); }
        let d = small_digits(&t);
        if !d.is_empty() { p.push(format!("digits {d:?}")); }
        p.is_empty().then_some(()).ok_or_else(|| p.join(", "))
    }), "Writing instructions (.textus/agent.md), house style: 'email' not 'e-mail', numbers one to nine spelled out, no exclamation marks. Expect the second paragraph rewritten friendlier and following all three ('within one day'), meaning kept.").disk(ws));

    // The global config folder's writing instructions, then the project's.
    let base = scratch("agentmd-global");
    put(&base, "global/agent.md", "<!--\nThis part is a comment and is never sent:\nAlways reply in French.\n-->\nAlways reply in English, whatever language the user writes in.");
    put(
        &base,
        "project/.textus/agent.md",
        "面向读者一律称“您”，不要用“你”。",
    );
    let ws = DiskWorkspace {
        global: Some(base.join("global")),
        doc_path: Some(put(&base, "project/邀请.md", INVITE_ZH)),
        show: vec![base.clone()],
        ..DiskWorkspace::default()
    };
    c.push(AgentCase::new("agentmd/global-plus-workspace", Lang::En, Lang::ZhHans, INVITE_ZH, "在文末加一句欢迎大家带朋友一起来的话。", edit_anywhere().check("addresses readers as 您", |o| (!proposed_text(o).contains('你')).then_some(()).ok_or_else(|| "used 你".into())), "Two layers of writing instructions: the global config folder's agent.md (reply in English; a commented-out 'reply in French' that must be ignored) and the project's .textus/agent.md (address readers as 您), headed as the project's. Expect a Chinese sentence at the end using 您, and an ENGLISH reply (not French, not Chinese).").disk(ws));

    // Library entries on disk, reached by alias.
    let dir = scratch("library-en");
    put(&dir, ".textus/library/ines.md", "---\nname: Ines Duarte\naliases: [the Captain, Captain Duarte]\n---\nCaptain of the Marrow. 52 years old, grew up in Porto. Afraid of fire since the engine-room blaze of 2009; she keeps an extinguisher by her bunk.");
    put(
        &dir,
        ".textus/library/marrow.md",
        "---\nname: Marrow\ninclude: never\n---\nAn old trawler. (Never sent: include is never.)",
    );
    let ws = doc_folder(&dir, "chapter-2.md", STORY_EN);
    c.push(AgentCase::new("library/en/alias-fact", Lang::En, Lang::En, STORY_EN, "How old is the Captain, and what is she afraid of?", no_edit().reply(&["52"]).check("names the fear", |o| o.reply.to_lowercase().contains("fire").then_some(()).ok_or_else(|| "no fire in the reply".into())), "The library entry Ines Duarte (aliases: the Captain) says she is 52 and afraid of fire since a 2009 engine-room blaze. Expect a short English answer from it, no edit.").mode(AgentMode::Review).disk(ws));

    let dir = scratch("library-zh");
    put(&dir, ".textus/library/lin.md", "---\nname: 林晚\naliases: [晚晚]\n---\n书店店员，二十九岁。从不喝咖啡，只喝热水或者淡茶。话很少。");
    let ws = doc_folder(&dir, "第三章.md", NOVEL_ZH);
    c.push(AgentCase::new("library/zh/consistency", Lang::ZhHans, Lang::ZhHans, NOVEL_ZH, "在最后加两句：老周给林晚倒了一杯喝的，两个人聊了几句。", edit_anywhere().check("added at the end", |o| {
        let (s, _, _) = checks::changed_span(&o.doc_before, &o.doc_after);
        (s >= o.doc_before.find("老周没再说话").unwrap_or(0)).then_some(()).ok_or_else(|| "not at the end".into())
    }).check("consistent with the library", |o| no_coffee_for_her(&inserted(o))), "The library says 林晚 never drinks coffee (only hot water or weak tea) and says little. Expect two sentences at the end where 老周 pours her hot water or tea (not coffee) and a brief exchange in her terse voice.").disk(ws));

    // Skills on disk: by /name and by description; the project's shadows
    // the global one of the same name.
    let dir = scratch("skill-zh-slash");
    put(&dir, ".textus/skills/runse.md", "---\nname: 润色\ndescription: 润色中文段落：去掉口水话和重复，保留全部事实和引用\n---\n润色时：删掉“其实”“基本上”“大家都觉得”这类口语；合并重复的意思；所有数字、人名、年份和引用原样保留；篇幅压缩到原来的 70% 左右；保持学术语气。每段只提一个修改。");
    let ws = doc_folder(&dir, "绿地.md", ACADEMIC_ZH);
    c.push(AgentCase::new("skill/zh/slash", Lang::ZhHans, Lang::ZhHans, ACADEMIC_ZH, "/润色 文献综述这一段", edit_in(para(ACADEMIC_ZH, 0), StructureExpect::Same).shorter().has(&["2019", "2021", "2022", "2.3"]).lacks(&["其实已经"]), "The user typed /润色 (the composer expands it into the skill's instructions): expect the literature paragraph polished per the skill - colloquialisms cut, ~70% length, every figure and citation kept - one edit, reply in Chinese.").disk(ws));

    let dir = scratch("skill-zh-description");
    put(&dir, ".textus/skills/minutes.md", "---\nname: 会议纪要\ndescription: 把零散的会议记录整理成规范的会议纪要（结论、待办、负责人、截止时间）\n---\n整理会议纪要时：用三个二级标题“结论”“待办”“待确认”；待办写成任务列表（* [ ]），每条写明负责人，记录里没有负责人的写“负责人待定”；不补充记录里没有的信息，不改动原有的事实。");
    let ws = doc_folder(&dir, "访谈.md", NOTES_ZH);
    c.push(AgentCase::new("skill/zh/by-description", Lang::ZhHans, Lang::ZhHans, NOTES_ZH, "帮我把这些零散的记录整理成正式的会议纪要。", edit_anywhere().tools(&["use_skill"]).has(&["负责人待定"]), "A project skill 会议纪要 matches by description: expect use_skill, then the notes reorganised under 结论 / 待办 / 待确认 with task items, '负责人待定' where the notes name no owner (the 手机请假 item), and nothing invented.").disk(ws));

    let base = scratch("skill-shadow");
    put(&base, "global/skills/headline.md", "---\nname: headline\ndescription: Write or rewrite document titles\n---\nTitles in Title Case, up to 12 words; a colon and a subtitle are welcome.");
    put(&base, "project/.textus/skills/headline.md", "---\nname: headline\ndescription: Write or rewrite document titles in the house style\n---\nHouse style for titles: sentence case, at most 6 words, no colon, lead with the concrete result.");
    let en = lang_doc(Lang::En).doc;
    let ws = DiskWorkspace {
        global: Some(base.join("global")),
        doc_path: Some(put(&base, "project/report.md", en)),
        show: vec![base.clone()],
        ..DiskWorkspace::default()
    };
    c.push(AgentCase::new("skill/en/project-shadows-global", Lang::En, Lang::En, en, "Give this document a better title.", edit_in("# Weekend Reading Club: first-year report", StructureExpect::Same).tools(&["use_skill"]).check("project skill followed", |o| {
        let title = o.doc_after.lines().next().unwrap_or("").trim_start_matches('#').trim().to_string();
        let words = title.split_whitespace().count();
        (words <= 6 && !title.contains(':')).then_some(()).ok_or_else(|| format!("{title:?}: {words} words"))
    }), "A global skill and a project skill share the name 'headline'; the project's (sentence case, ≤6 words, no colon) shadows the global one (Title Case, colon welcome). Expect use_skill to load the project version and the H1 rewritten to follow it.").disk(ws));
    c
}

fn style_cases() -> Vec<AgentCase> {
    let mut c = Vec::new();

    // Learn a profile from three samples.
    let dir = scratch("learn-zh");
    let learn = LearnStyle {
        samples: samples(&dir, &ZH_SAMPLES),
        write_to: None,
        checks: profile_checks(Lang::ZhHans, ZH_HABITS),
    };
    c.push(AgentCase::learn_only("style/zh/learn", Lang::ZhHans, learn, "Learn my style from three short Chinese essays by one author: very short sentences and paragraphs, 「」 for speech, no exclamation marks or dashes, paragraphs opened by a time or place, plain everyday words. Expect a profile in Chinese with the seven sections, concrete checkable bullets that capture these habits, a Never list of what the author avoids, and examples quoted verbatim - nothing generic or invented."));
    let dir = scratch("learn-en");
    let learn = LearnStyle {
        samples: samples(&dir, &EN_SAMPLES),
        write_to: None,
        checks: profile_checks(Lang::En, EN_HABITS),
    };
    c.push(AgentCase::learn_only("style/en/learn", Lang::En, learn, "Learn my style from three short English pieces: second person, present tense, British spelling (colour, realise, favourite), short declarative sentences, no semicolons or dashes, one- or two-line paragraphs, lists of concrete things. Expect an English profile with the seven sections capturing these habits, examples quoted verbatim, nothing invented."));

    // Learn, then write and complete under the learned profile.
    let dir = scratch("learned-zh");
    let learn = LearnStyle {
        samples: samples(&dir, &ZH_SAMPLES),
        write_to: Some(dir.join(".textus/style.md")),
        checks: profile_checks(Lang::ZhHans, ZH_HABITS),
    };
    let ws = doc_folder(&dir, "关于搬家.md", MOVING_ZH);
    let completion = CompletionCase::new("style/zh/learned-completion", Lang::ZhHans, "傍晚，我去楼下的面馆吃面。\n\n老板认得我。他说：「还是老样子？」\n\n我点点头。", "paragraph")
        .title("面馆", &["面馆"])
        .banned(&["！", "——", "“", "”"])
        .rubric("Under the learned profile (short sentences, 「」 speech, no exclamation marks): expect a short continuation in that voice.");
    c.push(AgentCase::new("style/zh/learned-applied", Lang::ZhHans, Lang::ZhHans, MOVING_ZH, "按我的风格改写这一段。", edit_in(para(MOVING_ZH, 0), StructureExpect::Any).check("learned habits followed", |o| rule_checks_zh(o, 18.0, 30)), "Learn my style (from three samples) wrote .textus/style.md; then 'rewrite this in my style' on a paragraph full of long sentences, ！ and ——. Expect short sentences, no ！ or ——, the author's plain voice, every fact kept (the details of moving, east to west of the city, two weeks). Then a completion under the same profile.").learn(learn).disk(ws).complete_after(completion));

    let dir = scratch("learned-en");
    let learn = LearnStyle {
        samples: samples(&dir, &EN_SAMPLES),
        write_to: Some(dir.join(".textus/style.md")),
        checks: profile_checks(Lang::En, EN_HABITS),
    };
    let ws = doc_folder(&dir, "moving.md", MOVING_EN);
    let completion = CompletionCase::new("style/en/learned-completion", Lang::En, "You open the door to the new flat. It smells of fresh paint and somebody else's cooking.", "paragraph")
        .title("Moving in", &["Moving in"])
        .space(true)
        .banned(&[";", "—", "color", "realiz", "favorite", "!"])
        .rubric("Under the learned profile (second person, British spelling, short sentences, no semicolons): expect a short continuation in that voice.");
    c.push(AgentCase::new("style/en/learned-applied", Lang::En, Lang::En, MOVING_EN, "Rewrite this paragraph in my style.", edit_in(para(MOVING_EN, 0), StructureExpect::Any).check("learned habits followed", |o| {
        let t = proposed_text(o);
        let lower = t.to_lowercase();
        let mut p = Vec::new();
        for us in ["color", "realiz", "favorite", "neighbor"] {
            if lower.contains(us) { p.push(format!("American {us}")); }
        }
        for mark in [";", "—"] {
            if t.contains(mark) { p.push(format!("uses {mark}")); }
        }
        let lengths = checks::sentence_lengths(&t);
        let avg = lengths.iter().sum::<usize>() as f64 / lengths.len().max(1) as f64;
        if avg > 14.0 { p.push(format!("average sentence {avg:.1} words")); }
        p.is_empty().then_some(()).ok_or_else(|| p.join(", "))
    }), "Learn my style wrote .textus/style.md from three second-person, British-spelling samples; then 'rewrite in my style' on a paragraph with semicolons, 'very', 'leverage', 'utilize' and an exclamation mark. Expect short sentences, no semicolons, British spelling, the author's voice (second person fits), facts kept (across town, two weeks, pack / contracts / internet, the checklist). Then a completion under the same profile.").learn(learn).disk(ws).complete_after(completion));

    // Hand-written profiles with hard rules.
    let dir = scratch("rules-zh");
    put(&dir, ".textus/style.md", ZH_RULES);
    let ws = doc_folder(&dir, "关于搬家.md", MOVING_ZH);
    c.push(AgentCase::new("style/zh/rules", Lang::ZhHans, Lang::ZhHans, MOVING_ZH, "把这段扩写成两段，多写写搬家那两个星期的感受。", edit_in(para(MOVING_ZH, 0), StructureExpect::Any).longer().check("profile rules followed", |o| rule_checks_zh(o, 20.0, 25)), "The project's style.md: sentences ≤ 20 characters, no 非常/十分/极其/特别, 「」 for quotes, no ！ or ——. Expect two paragraphs that follow every rule and expand on the feelings without inventing events (inner states and consequences of what is there are fine).").disk(ws));

    let dir = scratch("rules-en");
    put(&dir, ".textus/style.md", EN_RULES);
    let ws = doc_folder(&dir, "moving.md", MOVING_EN);
    c.push(AgentCase::new("style/en/banned-words", Lang::En, Lang::En, MOVING_EN, "Tidy up this paragraph.", edit_in(para(MOVING_EN, 0), StructureExpect::Any).check("profile rules followed", |o| rule_checks_en(o, &["very", "really", "leverage", "utilize", "incredibly"], 30.0)), "The project's style.md bans very/really/leverage/utilize/incredibly, semicolons and exclamation marks, and wants one to nine spelled out ('2 full weeks' -> 'two full weeks'). Expect the paragraph tidied with every rule followed and every fact kept.").disk(ws));

    // A profile in one language, a document in the other.
    let dir = scratch("cross-en-profile");
    put(&dir, ".textus/style.md", EN_PROFILE_FOR_ZH);
    let ws = doc_folder(&dir, "关于搬家.md", MOVING_ZH);
    c.push(AgentCase::new("style/cross/en-profile-zh-doc", Lang::ZhHans, Lang::ZhHans, MOVING_ZH, "把这段改得更好读一些。", edit_in(para(MOVING_ZH, 0), StructureExpect::Any).check("profile rules followed", |o| {
        let t = proposed_text(o);
        let mut p = Vec::new();
        for bad in ["！", "——", "!"] { if t.contains(bad) { p.push(format!("uses {bad}")); } }
        let lengths = checks::sentence_lengths(&t);
        let avg = lengths.iter().sum::<usize>() as f64 / lengths.len().max(1) as f64;
        if avg > 25.0 { p.push(format!("average sentence {avg:.1} characters")); }
        p.is_empty().then_some(()).ok_or_else(|| p.join(", "))
    }), "An English style profile (short sentences, no exclamation marks, no em dashes) on a Chinese document: expect the paragraph rewritten IN CHINESE (the profile's language must not leak into the text) following the rules - short sentences, no ！, no ——.").disk(ws));

    let dir = scratch("cross-zh-profile");
    put(&dir, ".textus/style.md", ZH_PROFILE_FOR_EN);
    let ws = doc_folder(&dir, "moving.md", MOVING_EN);
    c.push(AgentCase::new("style/cross/zh-profile-en-doc", Lang::En, Lang::En, MOVING_EN, "Tighten this paragraph.", edit_in(para(MOVING_EN, 0), StructureExpect::Any).shorter().check("profile rules followed", |o| {
        let t = proposed_text(o);
        let mut p = Vec::new();
        for bad in ["!", ";", "—"] { if t.contains(bad) { p.push(format!("uses {bad}")); } }
        let lower = t.to_lowercase();
        for w in ["very", "really"] {
            if lower.split(|c: char| !c.is_alphabetic()).any(|x| x == w) { p.push(format!("uses {w}")); }
        }
        let lengths = checks::sentence_lengths(&t);
        let avg = lengths.iter().sum::<usize>() as f64 / lengths.len().max(1) as f64;
        if avg > 15.0 { p.push(format!("average sentence {avg:.1} words")); }
        p.is_empty().then_some(()).ok_or_else(|| p.join(", "))
    }), "A Chinese style profile (sentences ≤ 15 words; no exclamation marks, dashes or semicolons; no very/really) on an English document: expect the paragraph tightened IN ENGLISH following those rules, facts kept.").disk(ws));

    // Quick Ask under a style profile: the widget path carries it too.
    let dir = scratch("quick-style-zh");
    put(&dir, ".textus/style.md", ZH_RULES);
    let ws = doc_folder(&dir, "外婆的厨房.md", ESSAY_ZH);
    c.push(AgentCase::new("style/zh/quick-ask", Lang::ZhHans, Lang::ZhHans, ESSAY_ZH, "改得更有画面感", edit_anywhere().check("edit inside the selection", in_selection).check("profile rules followed", |o| rule_checks_zh(o, 20.0, 25)), "Quick Ask on the selected second paragraph, with the project's style.md (≤ 20-character sentences, no 非常/特别, no ！/——): expect a more vivid rewrite of exactly the selection that keeps to the profile and invents nothing.").quick(para(ESSAY_ZH, 1)).disk(ws));
    c
}

/// Names the UI retired (docs/design/ai-concepts.md): "Workspace Folder" and
/// friends in en, zh and ja. A reply that uses one sends the user looking
/// for a label that no longer exists.
const RETIRED_NAMES: &[&str] = &[
    "workspace",
    "工作区",
    "ワークスペース",
    "chat instructions",
    "standing instructions",
];

/// Names the user's UI doesn't show: the other languages' labels for the
/// same concepts (the prompt gives all three, in parentheses), and English
/// mode names inside a Chinese or Japanese sentence ("Edit 模式").
fn other_languages_names(lang: Lang) -> &'static [&'static str] {
    match lang {
        Lang::En => &[
            "项目文件夹",
            "写作要求",
            "技能",
            "资料库",
            "文风档案",
            "学习我的文风",
            "全局配置文件夹",
            "プロジェクトフォルダー",
            "執筆の指示",
            "スキル",
            "ライブラリ",
            "文体プロファイル",
            "文体を学習",
            "グローバル設定フォルダー",
        ],
        Lang::Ja => &[
            "项目文件夹",
            "写作要求",
            "资料库",
            "文风档案",
            "学习我的文风",
            "全局配置文件夹",
            "review モード",
            "revise モード",
            "write モード",
            "style profile",
            "writing instructions",
        ],
        _ => &[
            "プロジェクトフォルダー",
            "執筆の指示",
            "スキル",
            "ライブラリ",
            "文体プロファイル",
            "文体を学習",
            "グローバル設定フォルダー",
            "review 模式",
            "revise 模式",
            "write 模式",
            "review模式",
            "revise模式",
            "style profile",
            "writing instructions",
        ],
    }
}

/// The reply names each concept asked about the way the UI does: one of
/// each group's spellings (case-insensitive), none of the retired names,
/// and none of the labels another UI language uses. Japanese replies also
/// keep the UI's long vowel in フォルダー.
fn uses_ui_names(
    lang: Lang,
    groups: &'static [&'static [&'static str]],
) -> impl Fn(&TurnOutcome) -> Result<(), String> + Send + Sync + 'static {
    move |o: &TurnOutcome| {
        let lower = o.reply.to_lowercase();
        let mut problems: Vec<String> = groups
            .iter()
            .filter(|g| !g.iter().any(|w| lower.contains(&w.to_lowercase())))
            .map(|g| format!("names none of {g:?}"))
            .collect();
        problems.extend(
            RETIRED_NAMES
                .iter()
                .chain(other_languages_names(lang))
                .filter(|w| lower.contains(*w))
                .map(|w| format!("says {w:?}")),
        );
        if lower.replace("フォルダー", "").contains("フォルダ") {
            problems.push("フォルダ without ー".into());
        }
        problems
            .is_empty()
            .then_some(())
            .ok_or_else(|| problems.join("; "))
    }
}

/// Questions about the concepts themselves, asked in the panel's default
/// Review mode from a saved document: the agent must answer with the names,
/// menu items and Settings rows the user's UI shows, in the user's
/// language (agent.rs's workspace_section tells it them in en, zh, ja).
fn concept_cases() -> Vec<AgentCase> {
    let mut c = Vec::new();

    let dir = scratch("concept-en-style");
    let ws = doc_folder(&dir, "mill-street.md", ESSAY_EN);
    c.push(AgentCase::new("concept/en/style", Lang::En, Lang::En, ESSAY_EN, "How do I get you to write more like me in this project?", no_edit().check("UI names", uses_ui_names(Lang::En, &[&["style profile"], &["learn my style"]])), "Expect a short English answer: the style profile (.textus/style.md), which Learn my style from samples… in the project menu drafts from the user's own writing (or Create style profile), followed in conversations and completion. Names as in the UI; no invented settings.").mode(AgentMode::Review).disk(ws));

    let dir = scratch("concept-zh-style");
    let ws = doc_folder(&dir, "外婆的厨房.md", ESSAY_ZH);
    c.push(AgentCase::new("concept/zh/style", Lang::ZhHans, Lang::ZhHans, ESSAY_ZH, "怎么才能让你以后都照我的文风来改稿？", no_edit().check("UI names", uses_ui_names(Lang::ZhHans, &[&["文风档案"], &["学习我的文风"]])), "Expect a short Chinese answer: the 文风档案 (.textus/style.md), drafted by 从样本学习我的文风… in the project menu (or 新建文风档案), followed in conversations and completion. UI names, full-width punctuation.").mode(AgentMode::Review).disk(ws));

    let dir = scratch("concept-zh-library");
    let ws = doc_folder(&dir, "第三章.md", NOVEL_ZH);
    c.push(AgentCase::new("concept/zh/library", Lang::ZhHans, Lang::ZhHans, NOVEL_ZH, "小说里的人物越来越多，怎么让你记住每个人的设定，别写错？", no_edit().check("UI names", uses_ui_names(Lang::ZhHans, &[&["资料库"]])), "Expect a short Chinese answer: the 资料库 (.textus/library/, one entry per character, made with 新建资料库条目… in the project menu; an entry is sent when its name or an alias comes up). Optionally the 写作要求 for project background. UI names only.").mode(AgentMode::Review).disk(ws));

    let dir = scratch("concept-en-global");
    let ws = doc_folder(&dir, "welcome.md", BETA_EN);
    c.push(AgentCase::new("concept/en/global-instructions", Lang::En, Lang::En, BETA_EN, "I want you to always reply in British English, in all my documents. Where do I set that once?", no_edit().check("UI names", uses_ui_names(Lang::En, &[&["writing instructions"], &["settings"]])), "Expect a short English answer: the global writing instructions, Settings > Textus AI > Writing Instructions (agent.md) > Edit agent.md, sent with every conversation in every document (a project's own writing instructions can add to them). No 'workspace', no invented menu.").mode(AgentMode::Review).disk(ws));

    let dir = scratch("concept-en-project");
    let ws = doc_folder(&dir, "chapter-2.md", STORY_EN);
    c.push(AgentCase::new("concept/en/project-instructions", Lang::En, Lang::En, STORY_EN, "This story needs its own rules: Ines narrates, and the tone stays dry. How do I give you rules for just this project?", no_edit().check("UI names", uses_ui_names(Lang::En, &[&["writing instructions"], &["edit project writing instructions", ".textus/agent.md"]])), "Expect a short English answer: the project's writing instructions, opened with Edit project writing instructions in the project menu (.textus/agent.md), sent after the global ones and winning where they conflict. Optionally the style profile for the dry tone and the library for Ines.").mode(AgentMode::Review).disk(ws));

    let dir = scratch("concept-zh-skill");
    let ws = doc_folder(&dir, "改期说明.md", EMAIL_ZH);
    c.push(AgentCase::new("concept/zh/skill", Lang::ZhHans, Lang::ZhHans, EMAIL_ZH, "我经常要把邮件改成正式的语气，能不能存成一个固定的指令，以后直接调用？", no_edit().check("UI names", uses_ui_names(Lang::ZhHans, &[&["技能"], &["/"]])), "Expect a short Chinese answer: a 技能 - one Markdown file (name, description, instructions) in .textus/skills/ for this project or the global config folder's skills/ (设置 > Textus AI > 技能 > 导入技能…), called with /名字 or matched by its description. UI names only.").mode(AgentMode::Review).disk(ws));

    let dir = scratch("concept-ja-folder");
    let ws = doc_folder(&dir, "リリース準備.md", TASKS_DOC_JA);
    c.push(AgentCase::new("concept/ja/folder", Lang::Ja, Lang::Ja, TASKS_DOC_JA, "別のフォルダーにある資料も読んでほしいのですが、どうすればいいですか？", no_edit().check("UI names", uses_ui_names(Lang::Ja, &[&["プロジェクトフォルダー"]])), "Expect a short Japanese answer: choose that folder (or a common parent) as the プロジェクトフォルダー with プロジェクトフォルダーを選択… in the project menu or 設定 > Textus AI > プロジェクトフォルダー; files outside it can't be read. UI names (フォルダー with ー), full-width punctuation.").mode(AgentMode::Review).disk(ws));

    let dir = scratch("concept-ja-style");
    let ws = doc_folder(&dir, "リリース準備.md", TASKS_DOC_JA);
    c.push(AgentCase::new("concept/ja/style", Lang::Ja, Lang::Ja, TASKS_DOC_JA, "自分の文体に合わせて書いてもらうにはどうすればいいですか？", no_edit().check("UI names", uses_ui_names(Lang::Ja, &[&["文体プロファイル"], &["文体を学習"]])), "Expect a short Japanese answer: the 文体プロファイル (.textus/style.md), drafted by サンプルから文体を学習… in the project menu (or 文体プロファイルを作成), followed in conversations and completion. UI names only.").mode(AgentMode::Review).disk(ws));
    c
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::live_eval::checks::Proposal;

    fn samples_text(set: &[(&str, &str); 3]) -> String {
        set.iter()
            .map(|(name, text)| format!("<sample name=\"{name}\">\n{text}\n</sample>\n\n"))
            .collect()
    }

    fn run(checks: &[(&'static str, ProfileCheck)], profile: &str, samples: &str) -> Vec<String> {
        checks
            .iter()
            .filter_map(|(name, c)| c(profile, samples).err().map(|e| format!("{name}: {e}")))
            .collect()
    }

    #[test]
    fn a_faithful_profile_passes_and_an_invented_example_fails() {
        let samples = samples_text(&ZH_SAMPLES);
        let good = "# Style profile\n\n## Voice and tone\n- 平静，克制。\n\n## Sentences and rhythm\n- 多用短句，每句十个字左右。\n\n## Word choice\n- 日常词汇。\n\n## Punctuation and formatting\n- 对话用「」。\n- 不用感叹号。\n\n## Structure\n- 段落以时间开头。\n\n## Never\n- 破折号。\n\n## Examples\n- 「车是二手的。车把上的漆掉了一块，铃铛也不响。」\n- 走出来的时候，天已经黑了。手里提着一把葱。\n";
        let checks = profile_checks(Lang::ZhHans, ZH_HABITS);
        assert_eq!(run(&checks, good, &samples), Vec::<String>::new());
        let invented = good.replace("手里提着一把葱。", "我在路灯下站了很久。");
        let failures = run(&checks, &invented, &samples);
        assert_eq!(failures.len(), 1, "{failures:?}");
        assert!(failures[0].contains("verbatim"));
        let six = good.replace("## Structure\n- 段落以时间开头。\n\n", "");
        assert!(run(&checks, &six, &samples)
            .iter()
            .any(|f| f.contains("seven")));
    }

    fn outcome(text: &str) -> TurnOutcome {
        TurnOutcome {
            proposals: vec![Proposal {
                action: "replace".into(),
                anchor: "x".into(),
                text: text.into(),
                context: String::new(),
            }],
            ..TurnOutcome::default()
        }
    }

    #[test]
    fn concept_replies_must_use_the_ui_names() {
        let reply = |text: &str| TurnOutcome {
            reply: text.into(),
            ..TurnOutcome::default()
        };
        let style = uses_ui_names(Lang::En, &[&["style profile"], &["learn my style"]]);
        assert!(style(&reply(
            "Use Learn my style from samples… to draft a style profile."
        ))
        .is_ok());
        let err = style(&reply("Put a style profile in your workspace.")).unwrap_err();
        assert!(
            err.contains("learn my style") && err.contains("workspace"),
            "{err}"
        );
        let err = style(&reply(
            "Use the style profile (文风档案) - Learn my style drafts it.",
        ))
        .unwrap_err();
        assert!(err.contains("文风档案"), "{err}");
        let zh = uses_ui_names(Lang::ZhHans, &[&["资料库"]]);
        assert!(zh(&reply("在资料库里建条目，然后在修订模式里改。")).is_ok());
        assert!(zh(&reply("在资料库里建条目，然后在 Revise 模式里改。")).is_err());
        let folder = uses_ui_names(Lang::Ja, &[&["プロジェクトフォルダー"]]);
        assert!(folder(&reply("プロジェクトフォルダーを選択…を使ってください。")).is_ok());
        let err = folder(&reply("プロジェクトフォルダーと別のフォルダを…")).unwrap_err();
        assert!(err.contains("ー"), "{err}");
        // Every concept case asks in Review mode, from a saved document.
        let cases = concept_cases();
        assert_eq!(cases.len(), 8);
        assert!(cases
            .iter()
            .all(|c| c.mode == AgentMode::Review && c.disk.is_some()));
    }

    #[test]
    fn rule_checks_measure_the_profiles_limits() {
        assert!(rule_checks_zh(
            &outcome("搬家很累。我们找了一辆车。她说：「慢点。」"),
            20.0,
            25
        )
        .is_ok());
        let bad = rule_checks_zh(&outcome("搬家非常累！他说：“慢点。”"), 20.0, 25).unwrap_err();
        assert!(
            bad.contains("非常") && bad.contains("！") && bad.contains("“”"),
            "{bad}"
        );
        let banned = ["very", "leverage"];
        assert!(rule_checks_en(
            &outcome("We moved in two weeks. It was hard."),
            &banned,
            30.0
        )
        .is_ok());
        let bad = rule_checks_en(
            &outcome("It took 2 very long weeks; we leveraged nothing!"),
            &banned,
            30.0,
        )
        .unwrap_err();
        assert!(
            bad.contains("very") && bad.contains(";") && bad.contains("!") && bad.contains("\"2\""),
            "{bad}"
        );
        assert!(no_coffee_for_her("老周给她倒了一杯热水，她不喝咖啡。").is_ok());
        assert!(no_coffee_for_her("老周给她倒了一杯咖啡。").is_err());
    }
}
