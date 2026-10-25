//! Live checks of what Textus AI remembers by itself (ai::memory): when it
//! calls `remember`, what it keeps, where (personal or the project's), and
//! that it doesn't keep what it shouldn't - a one-off request, something
//! private, what the document already says - or the same thing twice. And
//! that a memory is followed in a later conversation.
//!
//! Each case runs on its own temporary global folder and project folder,
//! with Remember automatically on, as the app has it by default.
//!
//!   cargo test --lib live_eval::memory_eval -- --ignored --nocapture --test-threads=1

use super::harness::{self, auth, AgentSetup, Conversation, UserTurn};
use crate::ai::agent::AgentMode;
use crate::ai::memory::{MemoryDirs, MemoryKind, Scope};
use crate::ai::workspace;
use std::path::PathBuf;

/// A fresh global folder and, with `project`, a project folder.
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
            let root = dir.path().join("novel");
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

    /// A memory already there, kept as the app keeps one.
    fn seed(&self, kind: &str, scope: &str, text: &str) {
        self.dirs()
            .keep(kind, scope, text, &Default::default())
            .expect("a memory kept");
    }

    /// The library entries Textus AI wrote (facts), by file name.
    fn facts(&self) -> Vec<String> {
        let Some(root) = &self.project else {
            return Vec::new();
        };
        let dir = root.join(".textus").join("library");
        std::fs::read_dir(&dir)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .map(|e| std::fs::read_to_string(e.path()).unwrap_or_default())
                    .collect()
            })
            .unwrap_or_default()
    }
}

fn run(
    folders: &Folders,
    mode: AgentMode,
    ui: &str,
    doc: &str,
    script: &[UserTurn],
) -> Option<Conversation> {
    let Some(auth) = auth() else {
        eprintln!("live_eval: no ANTHROPIC_API_KEY - skipping");
        return None;
    };
    let ws = match &folders.project {
        Some(root) => workspace::load_layers(None, None, Some(root.to_str().unwrap())),
        None => workspace::load_layers(None, None, None),
    };
    let model = harness::agent_model();
    let dirs = folders.dirs();
    let setup = AgentSetup {
        model: &model,
        mode,
        workspace: &ws,
        focus_heading: None,
        ui_language: ui,
        thinking: aicompat::capabilities::ThinkingLevel::Auto,
        pictures: None,
        memory: Some(&dirs),
    };
    let conv = harness::run_conversation(&auth, &setup, doc, script);
    assert!(conv.error.is_none(), "{:?}", conv.error);
    for (i, outcome) in conv.outcomes.iter().enumerate() {
        let remembered: Vec<String> = outcome
            .calls
            .iter()
            .filter(|c| c["name"] == "remember")
            .map(|c| c["args"].to_string())
            .collect();
        eprintln!(
            "live_eval: turn {}: tools {:?}\n  remember: {remembered:?}\n  reply: {}",
            i + 1,
            outcome.tools,
            harness::clip(&outcome.reply, 160)
        );
    }
    Some(conv)
}

/// The memories now there, as (scope, kind, text).
fn memories(folders: &Folders) -> Vec<(Scope, MemoryKind, String)> {
    folders
        .dirs()
        .load()
        .items
        .into_iter()
        .map(|m| (m.scope, m.kind, m.text))
        .collect()
}

const PARAGRAPH_ZH: &str = "港口在清晨显得格外安静。几条渔船靠在码头边上，船身随着海浪轻轻晃动，偶尔有一两只海鸥从水面掠过，发出几声清脆的叫声。";
const PARAGRAPH_EN: &str = "The harbour was very quiet in the early morning; a few fishing boats were tied up at the quay, rocking gently on the swell, and now and then a gull skimmed the water.";

/// A standing requirement about the user's writing in general, said in
/// passing with a request: kept, personal, as a requirement.
#[test]
#[ignore = "live API - see module docs"]
fn a_standing_requirement_is_remembered_as_personal() {
    for (ui, message, needle) in [
        ("zh", "以后给我写的标题都不要用句号结尾。这次先帮我把这段改得简洁一点。", "标题"),
        ("en", "From now on, always use British spelling in my writing. For now, just tighten this paragraph.", "British"),
    ] {
        let folders = Folders::new(false);
        let doc = if ui == "zh" { PARAGRAPH_ZH } else { PARAGRAPH_EN };
        let Some(_) = run(&folders, AgentMode::Write, ui, doc, &[UserTurn::new(message)]) else {
            return;
        };
        let kept = memories(&folders);
        assert_eq!(kept.len(), 1, "{ui}: {kept:?}");
        let (scope, kind, text) = &kept[0];
        assert_eq!(*scope, Scope::Personal, "{ui}");
        assert!(matches!(kind, MemoryKind::Requirement | MemoryKind::Style), "{ui}: {kind:?}");
        assert!(text.contains(needle), "{ui}: {text}");
    }
}

/// How this work must be written: kept for the project, not personally.
#[test]
#[ignore = "live API - see module docs"]
fn a_requirement_of_the_work_is_remembered_for_the_project() {
    let folders = Folders::new(true);
    let Some(_) = run(
        &folders,
        AgentMode::Write,
        "zh",
        PARAGRAPH_ZH,
        &[UserTurn::new(
            "这个项目是写给小学生看的，用词一定要浅显。帮我改一下这段。",
        )],
    ) else {
        return;
    };
    let kept = memories(&folders);
    assert!(
        kept.iter()
            .any(|(s, _, t)| *s == Scope::Project && (t.contains("小学") || t.contains("浅显"))),
        "{kept:?}"
    );
    assert!(
        kept.iter().all(|(s, _, _)| *s == Scope::Project),
        "personal too: {kept:?}"
    );
}

/// A fact about the work - a character - goes into the project's library.
#[test]
#[ignore = "live API - see module docs"]
fn a_fact_about_the_work_goes_into_the_library() {
    let folders = Folders::new(true);
    let Some(_) = run(
        &folders,
        AgentMode::Write,
        "zh",
        "第一章\n\n雨下了一整夜。",
        &[UserTurn::new(
            "林晚是这部小说的女主角，她是灯塔看守人，左手有一道旧伤疤。帮我续写一段。",
        )],
    ) else {
        return;
    };
    let facts = folders.facts();
    assert!(
        facts.iter().any(|f| f.contains("林晚")),
        "no library entry: {facts:?} / {:?}",
        memories(&folders)
    );
    // Not also as a memory.
    assert!(
        memories(&folders)
            .iter()
            .all(|(_, _, t)| !t.contains("伤疤")),
        "{:?}",
        memories(&folders)
    );
}

/// Nothing to keep: a one-off request, something private, what the
/// document says.
#[test]
#[ignore = "live API - see module docs"]
fn a_one_off_request_or_something_private_is_not_remembered() {
    for (mode, message) in [
        (AgentMode::Write, "把这段改短一点。"),
        (
            AgentMode::Write,
            "我的银行卡密码是 482913，顺便帮我把这段改得生动一些。",
        ),
        (AgentMode::Review, "总结一下这段在讲什么。"),
        (
            AgentMode::Write,
            "Make this one sentence more formal, just this once.",
        ),
    ] {
        let folders = Folders::new(true);
        let doc = if message.is_ascii() {
            PARAGRAPH_EN
        } else {
            PARAGRAPH_ZH
        };
        let Some(_) = run(&folders, mode, "zh", doc, &[UserTurn::new(message)]) else {
            return;
        };
        let kept = memories(&folders);
        assert!(kept.is_empty(), "{message}: {kept:?}");
        assert!(
            folders.facts().is_empty(),
            "{message}: {:?}",
            folders.facts()
        );
    }
}

/// A preference shown by correcting the AI: kept.
#[test]
#[ignore = "live API - see module docs"]
fn a_correction_that_states_a_preference_is_remembered() {
    let folders = Folders::new(false);
    let Some(_) = run(
        &folders,
        AgentMode::Write,
        "zh",
        PARAGRAPH_ZH,
        &[
            UserTurn::new("把这段改得更有画面感。"),
            UserTurn::new("别用破折号，我一直不喜欢破折号。重新改一下。"),
        ],
    ) else {
        return;
    };
    let kept = memories(&folders);
    assert!(
        kept.iter().any(|(_, _, t)| t.contains("破折号")),
        "{kept:?}"
    );
}

/// Said again, a memory isn't kept twice; changed, it is updated in place.
#[test]
#[ignore = "live API - see module docs"]
fn a_memory_is_not_kept_twice_and_a_change_updates_it() {
    let folders = Folders::new(false);
    folders.seed("preference", "personal", "Don't use semicolons.");
    folders.seed("requirement", "personal", "回复用英文。");
    let Some(_) = run(
        &folders,
        AgentMode::Write,
        "zh",
        PARAGRAPH_EN,
        &[UserTurn::new(
            "Remember: no semicolons, please. 另外以后回复都用中文吧。Now tighten this paragraph.",
        )],
    ) else {
        return;
    };
    let kept = memories(&folders);
    let semicolons = kept
        .iter()
        .filter(|(_, _, t)| t.to_lowercase().contains("semicolon") || t.contains("分号"))
        .count();
    assert_eq!(semicolons, 1, "{kept:?}");
    let replies: Vec<&String> = kept
        .iter()
        .map(|(_, _, t)| t)
        .filter(|t| {
            t.contains("回复")
                || t.to_lowercase().contains("reply")
                || t.to_lowercase().contains("respond")
        })
        .collect();
    assert_eq!(replies.len(), 1, "{kept:?}");
    assert!(
        replies[0].contains("中文") || replies[0].contains("Chinese"),
        "{kept:?}"
    );
}

/// No project folder: nothing about this one work is kept - not in a
/// library, and not as a personal memory, which every document gets.
#[test]
#[ignore = "live API - see module docs"]
fn without_a_project_folder_nothing_of_the_work_is_kept() {
    let folders = Folders::new(false);
    let Some(_) = run(
        &folders,
        AgentMode::Write,
        "zh",
        "第一章\n\n雨下了一整夜。",
        &[UserTurn::new(
            "林晚是女主角，她是灯塔看守人。以后写她的时候都用第三人称。续写一段。",
        )],
    ) else {
        return;
    };
    let kept = memories(&folders);
    // Nothing of this one work goes into what every document gets.
    assert!(kept.iter().all(|(_, _, t)| !t.contains("林晚")), "{kept:?}");
    assert!(folders.facts().is_empty());
}

/// A memory from before is followed: titles without a full stop.
#[test]
#[ignore = "live API - see module docs"]
fn a_remembered_requirement_is_followed_later() {
    let folders = Folders::new(false);
    folders.seed("requirement", "personal", "标题结尾不要加句号。");
    let Some(conv) = run(
        &folders,
        AgentMode::Write,
        "zh",
        PARAGRAPH_ZH,
        &[UserTurn::new("给这段文字起一个标题，加在最前面。")],
    ) else {
        return;
    };
    let text: String = conv.outcomes[0]
        .proposals
        .iter()
        .map(|p| p.text.clone())
        .collect();
    let title = text
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string();
    assert!(!title.is_empty(), "no title proposed");
    assert!(
        !title.ends_with('。') && !title.ends_with('.'),
        "title ends in a full stop: {title}"
    );
    // Nothing new to remember about it.
    assert_eq!(memories(&folders).len(), 1, "{:?}", memories(&folders));
}

/// A session's requests - more to write, a translation, notes on its hard
/// words - are tasks, and none of them a memory: the pass kept "translate
/// the whole text into English" as if it were a standing rule.
#[test]
#[ignore = "live API - see module docs"]
fn the_requests_of_a_writing_session_are_not_remembered() {
    let folders = Folders::new(true);
    let Some(_) = run(
        &folders,
        AgentMode::Write,
        "zh",
        PARAGRAPH_ZH,
        &[
            UserTurn::new("接着写一段，八百字左右，科幻风格。"),
            UserTurn::new("把全文翻译成英文，并把主角换成外国人。"),
            UserTurn::new("把文中比较难的英文单词都批注出来，写上中文意思。"),
        ],
    ) else {
        return;
    };
    let kept = memories(&folders);
    assert!(kept.is_empty(), "{kept:?}");
    assert!(folders.facts().is_empty(), "{:?}", folders.facts());
}

/// A memory says what holds - of the user or of the work - as mem0 keeps
/// facts, not the user's words as an order to the assistant.
#[test]
#[ignore = "live API - see module docs"]
fn a_memory_says_what_holds_not_the_users_command() {
    let folders = Folders::new(true);
    let Some(_) = run(
        &folders,
        AgentMode::Write,
        "zh",
        PARAGRAPH_EN,
        &[UserTurn::new("以后写英文都用英式拼写，别用美式的。")],
    ) else {
        return;
    };
    let kept = memories(&folders);
    eprintln!("live_eval: kept {kept:?}");
    assert_eq!(kept.len(), 1, "{kept:?}");
    let text = &kept[0].2;
    assert!(text.contains("英式"), "{text}");
    assert!(
        !text.contains("以后") && !text.contains("别用"),
        "the user's command, kept as said: {text}"
    );
}
