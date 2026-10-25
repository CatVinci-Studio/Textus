//! What Textus AI remembers over real use: several conversations on the
//! same work, a day apart, as people write in them - a preference said
//! once in passing or shown by turning a draft down, a fact told as
//! background to a request, a change of mind, something to forget - and
//! whether a later conversation, with nothing but the memories to go on,
//! works the way the user asked. memory_eval.rs checks single requests;
//! this checks the whole of it, the way mem0 and its peers are measured
//! (LOCOMO's recall over sessions), on a writer's work instead of chat.
//!
//! Each scenario runs on its own temporary global folder (and project
//! folder), with Remember automatically on. Every conversation starts
//! fresh: no history, only what was remembered. The report
//! (TEXTUS_EVAL_OUT, default target/live-eval) has each scenario's
//! conversations, what was remembered after each, and its checks.
//!
//!   cargo test --lib live_eval::memory_sessions -- --ignored --nocapture

use super::harness::{self, auth, AgentSetup, Conversation, UserTurn};
use crate::ai::agent::AgentMode;
use crate::ai::memory::{MemoryDirs, MemoryKind, Scope};
use crate::ai::workspace;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// One conversation: its mode, the document open in it, what the user
/// says in turn.
struct Session {
    mode: AgentMode,
    doc: &'static str,
    turns: Vec<UserTurn>,
}

fn session(mode: AgentMode, doc: &'static str, turns: &[&str]) -> Session {
    Session {
        mode,
        doc,
        turns: turns.iter().map(|t| UserTurn::new(*t)).collect(),
    }
}

/// The user turns this conversation's drafts down instead of accepting
/// them.
fn rejecting(mut s: Session) -> Session {
    for t in &mut s.turns {
        t.accept = false;
    }
    s
}

/// What the scenario ended with.
struct Ended {
    /// Every memory, as (scope, kind, text).
    memories: Vec<(Scope, MemoryKind, String)>,
    /// The library entries Textus AI wrote, whole.
    facts: Vec<String>,
    /// Each conversation, in order.
    conversations: Vec<Conversation>,
}

impl Ended {
    fn last(&self) -> &Conversation {
        self.conversations.last().expect("a conversation")
    }

    /// The text the last conversation proposed, all of it.
    fn last_text(&self) -> String {
        self.last()
            .outcomes
            .iter()
            .flat_map(|o| &o.proposals)
            .map(|p| p.text.clone())
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn last_reply(&self) -> String {
        self.last()
            .outcomes
            .last()
            .map(|o| o.reply.clone())
            .unwrap_or_default()
    }

    fn remembered(&self, any_of: &[&str]) -> usize {
        self.memories
            .iter()
            .filter(|(_, _, t)| {
                let t = t.to_lowercase();
                any_of.iter().any(|w| t.contains(&w.to_lowercase()))
            })
            .count()
    }

    fn in_library(&self, any_of: &[&str]) -> bool {
        self.facts
            .iter()
            .any(|f| any_of.iter().any(|w| f.contains(w)))
    }
}

type Check = (&'static str, fn(&Ended) -> bool);

struct Scenario {
    id: &'static str,
    project: bool,
    ui: &'static str,
    /// Memories already there, as (kind, scope, text): a user of some
    /// months, whose one memory that matters is among many.
    seed: Vec<(&'static str, &'static str, String)>,
    sessions: Vec<Session>,
    checks: Vec<Check>,
}

const NOVEL: &str = "# 第三章 灯塔\n\n雨停了，海面还是灰的。林晚把最后一桶煤油提上塔顶，手指冻得发红。\n\n远处有一艘船，灯忽明忽暗，像是在等什么人。\n";
const NOVEL_LATER: &str =
    "# 第四章 来客\n\n第二天一早，码头上多了一个陌生人。他背着一只旧帆布包，在灯塔下站了很久。\n";
const EMAIL: &str = "Hi Sam,\n\nThanks for the draft budget. I went through it last night and I think the travel line is too low, given that we now have three site visits instead of two. Could we revisit it before Friday? I also wonder whether the contingency should be a fixed amount rather than ten percent.\n\nBest,\nAlex\n";
const MEMO: &str = "Q3 update\n\nThe team shipped the new onboarding flow in July. Sign-ups went up, and support tickets about first-run setup went down. We still have open questions about the pricing page.\n";
const ESSAY: &str = "城市的夜晚\n\n我小时候住在老城区，晚上街道很安静。后来搬到新区，楼更高了，灯更亮了，可我总觉得少了点什么。\n";
const NOTICE_ZH: &str =
    "各位同事：\n\n感谢您这周的配合。请您在周四前提交报销单，逾期的话财务那边就要等下个月了。\n";
const NOTICE_ZH_2: &str = "各位同事：\n\n本周五例会改到下午三点。如您有议题，请您提前发给我。\n";
const NOVEL_EN: &str = "# Chapter 2\n\nThe rain had not stopped since noon. Mara stood at the vestry door with the keys in her fist, watching the gutter overflow onto the path.\n\nInside, someone had left the lamp burning.\n";
const GUIDE_EN: &str = "# Getting started\n\nCreate an account on the signup page. We will send you an e-mail with a link to confirm it.\n";
const PARAGRAPH_ZH: &str = "港口在清晨显得格外安静。几条渔船靠在码头边上，船身随着海浪轻轻晃动，偶尔有一两只海鸥从水面掠过。\n";

/// Thirty memories of a user of some months, none about titles.
fn many_memories() -> Vec<(&'static str, &'static str, String)> {
    [
        "代码块里的注释用英文。",
        "列表项结尾不加句号。",
        "数字用阿拉伯数字。",
        "英文书名用斜体。",
        "引用别人的话要注明出处。",
        "回复里不要用表情符号。",
        "日期写成 2026-10-22 的格式。",
        "称呼读者用“你”。",
        "段落不要超过五句话。",
        "专有名词第一次出现时给出英文原名。",
        "不要用“首先、其次、最后”。",
        "表格的表头加粗。",
        "货币写成 ¥1,200 的格式。",
        "缩写第一次出现时写出全称。",
        "不要在句首用“所以”。",
        "人名用全名。",
        "举例时用具体的数字。",
        "长句拆成短句。",
        "避免被动语态。",
        "邮件开头不写“您好”，直接写名字。",
        "技术文档里命令用代码格式。",
        "百分比用 % 符号。",
        "不要用感叹号。",
        "时间用 24 小时制。",
        "城市名后面不加“市”。",
        "公司名用简称。",
        "提到同事用名不用姓。",
        "不要写“众所周知”。",
        "引号用中文直角引号「」。",
        "版本号写成 v1.2.0。",
    ]
    .into_iter()
    .map(|t| ("preference", "personal", t.to_string()))
    .chain(std::iter::once((
        "requirement",
        "personal",
        "标题结尾不要加句号。".to_string(),
    )))
    .collect()
}

const PRODUCT: &str = "# Release notes\n\nThis release makes exporting faster and fixes the crash when a document had an empty table.\n";

fn scenarios() -> Vec<Scenario> {
    vec![
        // A novelist over three days: a character told as background, a
        // dislike shown once, then a change of mind about the character.
        Scenario {
            id: "novel/zh/character-and-dashes",
            project: true,
            ui: "zh",
            seed: Vec::new(),
            sessions: vec![
                session(AgentMode::Write, NOVEL, &[
                    "接着往下写一段。林晚这个人性子冷，不爱说话，开口也就三五个字。",
                    "破折号太多了，我不喜欢破折号，换个写法。",
                ]),
                session(AgentMode::Write, NOVEL_LATER, &[
                    "写林晚和这个陌生人第一次说话的场景，一两段就行。",
                ]),
                session(AgentMode::Write, NOVEL_LATER, &[
                    "跟你说下，从这章开始林晚变了，她话多了起来，会主动跟人搭话。写她请陌生人进塔里喝茶。",
                ]),
            ],
            checks: vec![
                ("the character is in the library", |e| e.in_library(&["林晚"])),
                ("the dislike of dashes is kept once", |e| e.remembered(&["破折号", "——", "dash"]) == 1),
                ("day two writes no dashes", |e| {
                    let t = &e.conversations[1].outcomes[0].proposals;
                    !t.is_empty() && t.iter().all(|p| !p.text.contains("——") && !p.text.contains('—'))
                }),
                ("the change of mind replaced the old fact", |e| {
                    let lin: Vec<&String> = e.facts.iter().filter(|f| f.contains("林晚")).collect();
                    lin.len() == 1 && (lin[0].contains("话多") || lin[0].contains("主动") || lin[0].contains("变"))
                }),
                ("the change says from where, and what held before stays", |e| {
                    e.facts.iter().any(|f| {
                        f.contains("林晚")
                            && ["第四章", "这章", "从", "起"].iter().any(|w| f.contains(w))
                            && ["冷", "不爱说话"].iter().any(|w| f.contains(w))
                    })
                }),
            ],
        },
        // An office worker: a reply preference said in irritation once,
        // then a question about another document days later.
        Scenario {
            id: "work/en/brief-replies",
            project: false,
            ui: "en",
            seed: Vec::new(),
            sessions: vec![
                session(AgentMode::Review, EMAIL, &[
                    "Is this email ok to send? Keep it short, I don't have time to read essays.",
                ]),
                session(AgentMode::Review, MEMO, &["Does this read clearly?"]),
            ],
            checks: vec![
                ("the preference is kept, as personal", |e| {
                    e.memories.iter().any(|(s, _, t)| {
                        let t = t.to_lowercase();
                        *s == Scope::Personal && (t.contains("short") || t.contains("brief") || t.contains("concise"))
                    })
                }),
                ("the later reply is short", |e| e.last_reply().split_whitespace().count() <= 80),
            ],
        },
        // Turning the same thing down twice, then saying why: a standing
        // preference shown by rejections, which a next draft follows.
        Scenario {
            id: "essay/zh/rejected-drafts",
            project: false,
            ui: "zh",
            seed: Vec::new(),
            sessions: vec![
                rejecting(session(AgentMode::Write, ESSAY, &["把这段改得更有文采一点。"])),
                session(AgentMode::Write, ESSAY, &[
                    "还是太华丽了，我写东西喜欢朴素一点，不要用那些形容词堆起来的句子。再改一次。",
                ]),
                session(AgentMode::Write, ESSAY, &["帮我把这段扩写一下，多写点老城区的细节。"]),
            ],
            checks: vec![
                ("the plain style is kept", |e| e.remembered(&["朴素", "平实", "华丽", "形容词", "plain"]) >= 1),
                ("nothing about this one essay is kept", |e| e.remembered(&["老城区", "新区"]) == 0),
            ],
        },
        // What must not be kept: one-off asks and something private.
        Scenario {
            id: "work/zh/nothing-to-keep",
            project: false,
            ui: "zh",
            seed: Vec::new(),
            sessions: vec![
                session(AgentMode::Write, MEMO, &[
                    "这段改正式一点，要发给老板。",
                    "在最后加一句：有问题可以打我电话 138 1234 5678，或者到徐汇区漕溪北路 88 号找我。",
                ]),
            ],
            checks: vec![
                ("no one-off request is kept", |e| e.remembered(&["正式", "老板"]) == 0),
                ("nothing private is kept", |e| e.remembered(&["138", "漕溪", "徐汇"]) == 0),
            ],
        },
        // A rule kept earlier, then let go of in passing.
        Scenario {
            id: "work/en/forget-a-rule",
            project: false,
            ui: "en",
            seed: Vec::new(),
            sessions: vec![
                session(AgentMode::Write, MEMO, &[
                    "From now on, never use semicolons in anything you write for me. Tighten this.",
                ]),
                session(AgentMode::Write, MEMO, &[
                    "Actually, forget the no-semicolons thing - semicolons are fine again. Add a sentence about the pricing page.",
                ]),
            ],
            checks: vec![
                ("the rule is gone or reversed", |e| {
                    e.memories.iter().all(|(_, _, t)| {
                        let t = t.to_lowercase();
                        !t.contains("semicolon") || t.contains("fine") || t.contains("allowed") || t.contains("ok")
                    })
                }),
            ],
        },
        // A project's own term, set right once, used right later.
        Scenario {
            id: "tech/en/product-name",
            project: true,
            ui: "en",
            seed: Vec::new(),
            sessions: vec![
                session(AgentMode::Write, PRODUCT, &[
                    "Add a line saying the app now opens folders. And it's Textus, one word, capital T only - people keep writing TextUs.",
                ]),
                session(AgentMode::Write, PRODUCT, &["Add a short paragraph thanking the beta testers."]),
            ],
            checks: vec![
                ("the spelling is kept for the project", |e| {
                    e.memories.iter().any(|(s, _, t)| *s == Scope::Project && t.contains("Textus"))
                        || e.in_library(&["Textus"])
                }),
                ("the later text spells it right", |e| !e.last_text().contains("TextUs")),
            ],
        },
        // The same correction twice, in two conversations, never said as a
        // rule: the third conversation writes that way unasked.
        Scenario {
            id: "work/zh/same-correction-twice",
            project: false,
            ui: "zh",
            seed: Vec::new(),
            sessions: vec![
                session(AgentMode::Write, NOTICE_ZH, &["把里面的“您”都改成“你”，我们内部发的东西不用“您”。"]),
                session(AgentMode::Write, NOTICE_ZH_2, &["这个也是，“您”改成“你”。"]),
                session(AgentMode::Write, "", &["写一段内部通知：周五下午两点到四点停电，请大家提前保存文件。"]),
            ],
            checks: vec![
                ("the habit is kept once", |e| e.remembered(&["您"]) == 1),
                ("the third conversation writes 你, not 您", |e| {
                    let t = e.last_text();
                    !t.is_empty() && !t.contains('您')
                }),
            ],
        },
        // A reply language asked for in passing, with another request.
        Scenario {
            id: "chat/zh/reply-in-english",
            project: false,
            ui: "zh",
            seed: Vec::new(),
            sessions: vec![
                session(AgentMode::Review, ESSAY, &["这段写得怎么样？对了，以后都用英文回我，我在练英文。"]),
                session(AgentMode::Review, PARAGRAPH_ZH, &["这段有什么可以改进的地方？"]),
            ],
            checks: vec![
                ("the language is kept, as personal", |e| {
                    e.memories.iter().any(|(s, _, t)| {
                        *s == Scope::Personal && (t.contains("英文") || t.to_lowercase().contains("english"))
                    })
                }),
                ("the later reply is in English", |e| {
                    let r = e.last_reply();
                    let cjk = r.chars().filter(|c| ('\u{4e00}'..='\u{9fff}').contains(c)).count();
                    !r.is_empty() && cjk * 10 < r.chars().count()
                }),
            ],
        },
        // A fact about a character, said in the third turn of a working
        // session full of one-off asks.
        Scenario {
            id: "novel/en/buried-fact",
            project: true,
            ui: "en",
            seed: Vec::new(),
            sessions: vec![
                session(AgentMode::Write, NOVEL_EN, &[
                    "Continue the scene, one paragraph.",
                    "Shorter, please - two or three sentences.",
                    "Good. By the way, Mara never swears, she's the minister's daughter. Add a line where she finds the lamp and is furious.",
                    "Now add the sound of the rain on the roof.",
                ]),
                session(AgentMode::Write, NOVEL_EN, &["Write the moment Mara finds the vestry window smashed and her notebook gone."]),
            ],
            checks: vec![
                ("the fact is kept for the project", |e| {
                    e.in_library(&["swear"]) || e.memories.iter().any(|(s, _, t)| *s == Scope::Project && t.contains("swear"))
                }),
                ("the one-off asks are not kept", |e| e.remembered(&["shorter", "rain", "two or three"]) == 0),
                ("Mara still doesn't swear", |e| {
                    let t = e.last_text().to_lowercase();
                    // Whole words: "hello" isn't "hell".
                    let words: Vec<&str> = t.split(|c: char| !c.is_alphabetic()).collect();
                    !t.is_empty()
                        && !["damn", "hell", "shit", "fuck", "fucking", "bloody", "christ"]
                            .iter()
                            .any(|w| words.contains(w))
                }),
            ],
        },
        // A house style, given while fixing something else.
        Scenario {
            id: "tech/en/house-spelling",
            project: true,
            ui: "en",
            seed: Vec::new(),
            sessions: vec![
                session(AgentMode::Write, GUIDE_EN, &[
                    "Fix the typos here. Also our style guide says email, never e-mail, and sign-up with a hyphen when it's a noun.",
                ]),
                session(AgentMode::Write, GUIDE_EN, &["Add a paragraph saying people can now sign up with their email address alone, on the new sign-up page."]),
            ],
            checks: vec![
                ("the style is kept for the project", |e| {
                    e.memories.iter().any(|(s, _, t)| *s == Scope::Project && t.to_lowercase().contains("e-mail"))
                }),
                ("the later text writes email", |e| {
                    let t = e.last_text();
                    !t.is_empty() && !t.contains("e-mail")
                }),
            ],
        },
        // One memory that matters among thirty that don't.
        Scenario {
            id: "scale/zh/one-of-thirty",
            project: false,
            ui: "zh",
            seed: many_memories(),
            sessions: vec![session(AgentMode::Write, PARAGRAPH_ZH, &["给这段文字起一个标题，加在最前面。"])],
            checks: vec![
                ("the title has no full stop", |e| {
                    let t = e.last_text();
                    let title = t.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string();
                    !title.is_empty() && !title.ends_with('。') && !title.ends_with('.')
                }),
                ("nothing new is kept", |e| e.memories.len() == 31),
            ],
        },
    ]
}

struct Folders {
    _dir: tempfile::TempDir,
    global: PathBuf,
    project: Option<PathBuf>,
}

impl Folders {
    fn new(project: bool) -> Folders {
        let dir = tempfile::tempdir().expect("a temp dir");
        let global = dir.path().join("global");
        std::fs::create_dir_all(&global).unwrap();
        let project = project.then(|| {
            let root = dir.path().join("work");
            std::fs::create_dir_all(root.join(".textus")).unwrap();
            root
        });
        Folders {
            _dir: dir,
            global,
            project,
        }
    }

    fn dirs(&self) -> MemoryDirs {
        MemoryDirs::new(Some(&self.global), self.project.as_deref())
    }

    fn memories(&self) -> Vec<(Scope, MemoryKind, String)> {
        self.dirs()
            .load()
            .items
            .into_iter()
            .map(|m| (m.scope, m.kind, m.text))
            .collect()
    }

    fn facts(&self) -> Vec<String> {
        let Some(root) = &self.project else {
            return Vec::new();
        };
        read_all(&root.join(".textus").join("library"))
    }
}

fn read_all(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .map(|e| std::fs::read_to_string(e.path()).unwrap_or_default())
                .collect()
        })
        .unwrap_or_default()
}

fn memory_json(folders: &Folders) -> Value {
    json!({
        "memories": folders.memories().iter().map(|(s, k, t)| json!({"scope": format!("{s:?}"), "kind": format!("{k:?}"), "text": t})).collect::<Vec<_>>(),
        "library": folders.facts(),
    })
}

fn run_scenario(
    auth: &aicompat::providers::anthropic::AnthropicAuth,
    scenario: &Scenario,
) -> Value {
    let folders = Folders::new(scenario.project);
    let model = harness::agent_model();
    let dirs = folders.dirs();
    let ws = match &folders.project {
        Some(root) => workspace::load_layers(None, None, Some(root.to_str().unwrap())),
        None => workspace::load_layers(None, None, None),
    };
    for (kind, scope, text) in &scenario.seed {
        folders
            .dirs()
            .keep(kind, scope, text, &Default::default())
            .expect("a memory kept");
    }
    let mut conversations = Vec::new();
    let mut log = Vec::new();
    for (n, s) in scenario.sessions.iter().enumerate() {
        let setup = AgentSetup {
            model: &model,
            mode: s.mode,
            workspace: &ws,
            focus_heading: None,
            ui_language: scenario.ui,
            thinking: aicompat::capabilities::ThinkingLevel::Auto,
            pictures: None,
            memory: Some(&dirs),
        };
        let conv = harness::run_conversation(auth, &setup, s.doc, &s.turns);
        log.push(json!({
            "conversation": n + 1,
            "mode": format!("{:?}", s.mode),
            "error": conv.error,
            "turns": conv.outcomes.iter().map(|o| json!({
                "user": o.message,
                "remember_calls": o.calls.iter().filter(|c| c["name"] == "remember").map(|c| c["args"].clone()).collect::<Vec<_>>(),
                "pass_answer": o.calls.iter().find(|c| c["name"] == "memory_pass").map(|c| c["result"].clone()),
                "proposed": o.proposals.iter().map(|p| p.text.clone()).collect::<Vec<_>>(),
                "reply": o.reply,
            })).collect::<Vec<_>>(),
            "remembered_after": memory_json(&folders),
        }));
        conversations.push(conv);
    }
    let ended = Ended {
        memories: folders.memories(),
        facts: folders.facts(),
        conversations,
    };
    let checks: Vec<Value> = scenario
        .checks
        .iter()
        .map(|(name, check)| json!({"check": name, "pass": check(&ended)}))
        .collect();
    for c in &checks {
        eprintln!(
            "memory_sessions: {} - {} {}",
            scenario.id,
            if c["pass"] == true { "ok  " } else { "FAIL" },
            c["check"].as_str().unwrap_or("")
        );
    }
    json!({"id": scenario.id, "conversations": log, "checks": checks})
}

/// Every scenario, its report written, its checks summed up. Reports only:
/// a scenario's checks are for comparing one way of remembering with
/// another, not a gate.
#[test]
#[ignore = "live API - see module docs"]
fn live_memory_over_sessions() {
    let Some(auth) = auth() else { return };
    let scenarios: Vec<Scenario> = scenarios()
        .into_iter()
        .filter(|s| harness::selected(s.id))
        .collect();
    let reports = harness::par_map(&scenarios, |s| run_scenario(&auth, s));
    let passed = reports
        .iter()
        .flat_map(|r| r["checks"].as_array().cloned().unwrap_or_default())
        .filter(|c| c["pass"] == true)
        .count();
    let total: usize = reports
        .iter()
        .map(|r| r["checks"].as_array().map_or(0, Vec::len))
        .sum();
    eprintln!("memory_sessions: {passed}/{total} checks passed");
    let out = std::env::var("TEXTUS_EVAL_OUT")
        .unwrap_or_else(|_| format!("{}/target/live-eval", env!("CARGO_MANIFEST_DIR")));
    std::fs::create_dir_all(&out).unwrap();
    let path = format!("{out}/memory-sessions.json");
    std::fs::write(&path, serde_json::to_string_pretty(&reports).unwrap()).unwrap();
    eprintln!("memory_sessions: report at {path}");
}

/// The memory tidied (memory::tidy) on the eval's provider: three ways of
/// saying "reply in English", a rule a later one overturned, and others
/// that must stay as they are.
#[test]
#[ignore = "live API - see module docs"]
fn live_memory_tidy() {
    use crate::ai::memory::{tidy_if_due, Source};
    use aicompat::agent::{AgentTurn, StepResult};
    use aicompat::providers::AgentProvider;
    let Some(auth) = auth() else { return };
    let dir = tempfile::tempdir().unwrap();
    let dirs = MemoryDirs::new(Some(dir.path()), None);
    let source = Source::default();
    let said = [
        "Reply in English.",
        "Use short sentences in replies.",
        "Always answer me in English.",
        "Write 你, never 您.",
        "Never use exclamation marks.",
        "Answer in English, please, even when I write Chinese.",
        "Use 您 in letters to clients.",
        "Keep headings in title case.",
        "Prefer the Oxford comma.",
    ];
    for text in said {
        dirs.keep("preference", "personal", text, &source).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let agent = AgentProvider {
        id: harness::agent_provider_id().to_string(),
        model: harness::agent_model(),
        endpoint: harness::agent_endpoint(&auth),
        thinking: Default::default(),
        native_search: None,
        enforce_binding: true,
    };
    let started = std::time::Instant::now();
    let made = harness::block_on(tidy_if_due(&dirs, &source, |instructions, input| {
        let agent = &agent;
        async move {
            let turn = [AgentTurn::User {
                text: input,
                images: Vec::new(),
            }];
            let (step, _) = agent.step(&instructions, &turn, &[], &|_| {}).await?;
            Ok(match step {
                StepResult::Done(text) => text,
                _ => String::new(),
            })
        }
    }))
    .unwrap();
    let left: Vec<String> = dirs.load().items.into_iter().map(|m| m.text).collect();
    eprintln!(
        "memory_tidy: {} changes in {:.1} s; {} memories left:\n{}",
        made.len(),
        started.elapsed().as_secs_f64(),
        left.len(),
        left.join("\n")
    );
    let english = left.iter().filter(|m| m.contains("English")).count();
    assert_eq!(english, 1, "one English rule left");
    // The exception to the 你 rule is kept, with the rule or in it.
    assert!(
        left.iter().any(|m| m.contains("letters")),
        "the exception kept"
    );
    for kept in ["exclamation", "title case", "Oxford"] {
        assert!(left.iter().any(|m| m.contains(kept)), "{kept} kept");
    }
}

/// Whether a request is offered as a skill (memory::skill_offer), on the
/// eval's provider: a procedure of the user's own is, a one-off request
/// about this text and one a skill already does are not.
#[test]
#[ignore = "live API - see module docs"]
fn live_skill_offer() {
    use crate::ai::memory::{offer_skill, Exchange};
    use aicompat::agent::{AgentTurn, StepResult};
    use aicompat::providers::AgentProvider;
    let Some(auth) = auth() else { return };
    let agent = AgentProvider {
        id: harness::agent_provider_id().to_string(),
        model: harness::agent_model(),
        endpoint: harness::agent_endpoint(&auth),
        thinking: Default::default(),
        native_search: None,
        enforce_binding: true,
    };
    let skills = vec![crate::ai::workspace::parse_skill_file(
        "translate",
        "---\nname: translate\ndescription: Translates a passage or document into another language.\n---\n\nTranslate it.",
    )];
    let ask = |message: &str| {
        let exchange = Exchange {
            messages: vec![message.into()],
            reply: "Done - the edits are proposed in the document.".into(),
        };
        harness::block_on(offer_skill(&exchange, &skills, |instructions, input| {
            let agent = &agent;
            async move {
                let turn = [AgentTurn::User {
                    text: input,
                    images: Vec::new(),
                }];
                let (step, _) = agent.step(&instructions, &turn, &[], &|_| {}).await?;
                Ok(match step {
                    StepResult::Done(text) => text,
                    _ => String::new(),
                })
            }
        }))
        .unwrap()
    };
    let procedure = ask("把我的会议记录整理成周报：分成「本周完成」「下周计划」「风险」三部分，每条一句话，不写人名，数字保留，最后加一行需要老板决定的事。");
    eprintln!("skill_offer: procedure -> {procedure:?}");
    let one_off = ask("把第二段改得更简洁一些，别丢数字，语气保持正式一点就好。");
    eprintln!("skill_offer: one-off -> {one_off:?}");
    let covered = ask("Translate this whole document into English, keeping it faithful to the original wording please.");
    eprintln!("skill_offer: covered by translate -> {covered:?}");
    assert!(procedure.is_some(), "the procedure is offered");
    assert!(one_off.is_none(), "a one-off is not");
    assert!(covered.is_none(), "nor what translate already does");
}
