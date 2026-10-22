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
    sessions: Vec<Session>,
    checks: Vec<Check>,
}

const NOVEL: &str = "# 第三章 灯塔\n\n雨停了，海面还是灰的。林晚把最后一桶煤油提上塔顶，手指冻得发红。\n\n远处有一艘船，灯忽明忽暗，像是在等什么人。\n";
const NOVEL_LATER: &str =
    "# 第四章 来客\n\n第二天一早，码头上多了一个陌生人。他背着一只旧帆布包，在灯塔下站了很久。\n";
const EMAIL: &str = "Hi Sam,\n\nThanks for the draft budget. I went through it last night and I think the travel line is too low, given that we now have three site visits instead of two. Could we revisit it before Friday? I also wonder whether the contingency should be a fixed amount rather than ten percent.\n\nBest,\nAlex\n";
const MEMO: &str = "Q3 update\n\nThe team shipped the new onboarding flow in July. Sign-ups went up, and support tickets about first-run setup went down. We still have open questions about the pricing page.\n";
const ESSAY: &str = "城市的夜晚\n\n我小时候住在老城区，晚上街道很安静。后来搬到新区，楼更高了，灯更亮了，可我总觉得少了点什么。\n";
const PRODUCT: &str = "# Release notes\n\nThis release makes exporting faster and fixes the crash when a document had an empty table.\n";

fn scenarios() -> Vec<Scenario> {
    vec![
        // A novelist over three days: a character told as background, a
        // dislike shown once, then a change of mind about the character.
        Scenario {
            id: "novel/zh/character-and-dashes",
            project: true,
            ui: "zh",
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
            ],
        },
        // An office worker: a reply preference said in irritation once,
        // then a question about another document days later.
        Scenario {
            id: "work/en/brief-replies",
            project: false,
            ui: "en",
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
            sessions: vec![
                rejecting(session(AgentMode::Revise, ESSAY, &["把这段改得更有文采一点。"])),
                session(AgentMode::Revise, ESSAY, &[
                    "还是太华丽了，我写东西喜欢朴素一点，不要用那些形容词堆起来的句子。再改一次。",
                ]),
                session(AgentMode::Revise, ESSAY, &["帮我把这段扩写一下，多写点老城区的细节。"]),
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
            sessions: vec![
                session(AgentMode::Revise, MEMO, &[
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
            sessions: vec![
                session(AgentMode::Revise, MEMO, &[
                    "From now on, never use semicolons in anything you write for me. Tighten this.",
                ]),
                session(AgentMode::Revise, MEMO, &[
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
            sessions: vec![
                session(AgentMode::Revise, PRODUCT, &[
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
        Some(root) => workspace::load_layers(None, None, Some(root.to_str().unwrap()), &[]),
        None => workspace::load_layers(None, None, None, &[]),
    };
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
