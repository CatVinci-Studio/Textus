//! Where a request keeps the user waiting: each case prints the stream's
//! timeline (harness::Timeline) - when thinking ends, when the edit's
//! arguments start, how long the anchor takes before the preview can be
//! placed - for a rewrite and a continuation in Write, with
//! Deep thinking off and on.
//!
//!   TEXTUS_EVAL_TIMELINE=1 cargo test --lib live_eval::latency -- --ignored --nocapture --test-threads=1

use super::harness::{self, auth, AgentSetup, UserTurn};
use crate::ai::agent::AgentMode;
use crate::ai::workspace;
use aicompat::capabilities::ThinkingLevel;

const DOC: &str = "# 社区图书馆的夜间开放\n\n去年秋天，街道图书馆开始试行夜间开放，每周三和周五开到晚上十点。最初只是为了方便下班的上班族，结果来的人里有一半是附近中学的学生，他们说家里太吵，图书馆的灯和安静比什么都重要。\n\n管理员老周说，夜里来的人和白天不一样。白天多是老人看报纸，孩子跟着家长借绘本；到了晚上，自习区坐满了人，翻书的声音和敲键盘的声音混在一起，偶尔有人小声讨论题目。为了让大家安心，图书馆加了两名志愿者，负责巡视和帮人找书。\n\n试行半年，夜间的借阅量占了全天的三成。街道打算明年把开放日增加到每周四天，还准备在一楼加一个可以小声说话的讨论区，让需要合作的学生不必躲到楼梯间。\n\n不过也有居民提出意见：晚上回家的路灯太暗，女学生结伴走才放心。图书馆和街道正在商量，在门口到公交站这一段加装照明。\n";

fn run(mode: AgentMode, thinking: ThinkingLevel, message: &str) {
    run_on(DOC, None, mode, thinking, message);
}

fn run_on(
    doc: &str,
    pictures: Option<&crate::ai::images::ImageRun>,
    mode: AgentMode,
    thinking: ThinkingLevel,
    message: &str,
) {
    let Some(auth) = auth() else {
        eprintln!("live_eval: no ANTHROPIC_API_KEY - skipping");
        return;
    };
    let ws = workspace::load_layers(None, None, None, &[]);
    let model = harness::agent_model();
    let setup = AgentSetup {
        model: &model,
        mode,
        workspace: &ws,
        focus_heading: None,
        ui_language: "zh",
        thinking,
        pictures,
        memory: None,
    };
    eprintln!("live_eval: {mode:?} / {thinking:?}: {message}");
    let conv = harness::run_conversation(&auth, &setup, doc, &[UserTurn::new(message)]);
    assert!(conv.error.is_none(), "{:?}", conv.error);
    for outcome in &conv.outcomes {
        eprintln!("  tools {:?}", outcome.tools);
        // Tokens, for the spend on a provider with a budget (Gemini).
        let (input, output) = outcome.usage.iter().fold((0, 0), |(i, o), u| {
            (
                i + u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
                o + u.output_tokens,
            )
        });
        eprintln!("  tokens in {input} out {output}");
        for call in outcome.calls.iter().filter(|c| c["name"] == "propose_edit") {
            let args = &call["args"];
            eprintln!(
                "  edit {}: {:?} -> {:?}",
                args["action"],
                harness::clip(args["anchor"].as_str().unwrap_or(""), 30),
                harness::clip(args["text"].as_str().unwrap_or(""), 50)
            );
            // The pictures it carries, as placed (textus-generated:ID).
            for line in args["text"].as_str().unwrap_or("").lines() {
                if line.trim_start().starts_with("![") {
                    eprintln!("    picture {}", harness::clip(line, 80));
                }
            }
        }
        eprintln!("  reply: {}", harness::clip(&outcome.reply, 120));
    }
}

#[test]
#[ignore = "live: calls the model"]
fn revise_whole_document() {
    run(
        AgentMode::Write,
        ThinkingLevel::Auto,
        "帮我把全文润色一下，语气更像新闻报道",
    );
    run(
        AgentMode::Write,
        ThinkingLevel::Deep,
        "帮我把全文润色一下，语气更像新闻报道",
    );
}

#[test]
#[ignore = "live: calls the model"]
fn revise_one_paragraph() {
    run(
        AgentMode::Write,
        ThinkingLevel::Auto,
        "第二段写得啰嗦，帮我精简",
    );
    run(
        AgentMode::Write,
        ThinkingLevel::Deep,
        "第二段写得啰嗦，帮我精简",
    );
}

#[test]
#[ignore = "live: calls the model"]
fn write_continuation() {
    run(
        AgentMode::Write,
        ThinkingLevel::Deep,
        "在最后续写一段，讲讲志愿者的故事",
    );
}

/// Redoing a picture already in the document: how long from the reply to
/// the call's `anchor` (where the redo shows) and to its whole `prompt`
/// (when the picture can be asked for). Pictures made offline.
#[test]
#[ignore = "live: calls the model"]
fn redo_a_picture() {
    let doc = format!("{DOC}\n![夜里的图书馆](images/library.png)\n");
    let pictures = crate::ai::images::ImageRun::offline(2);
    run_on(
        &doc,
        Some(&pictures),
        AgentMode::Write,
        ThinkingLevel::Auto,
        "把这张图改成下雨的夜晚，窗户透出暖光",
    );
}

/// The writer's own case (rc.6): a story of 2,000 characters translated
/// whole, its picture redone with it - "Thinking…" for a long time, then
/// every change at once. When the edit's call starts, how its arguments
/// come (by block, by anchor), and the gaps in between.
#[test]
#[ignore = "live: calls the model"]
fn translate_a_story_with_its_picture() {
    let doc = include_str!("fixtures/borrowing-rain.md");
    let pictures = crate::ai::images::ImageRun::offline(2);
    run_on(
        doc,
        Some(&pictures),
        AgentMode::Write,
        ThinkingLevel::Auto,
        "翻译为英文，并且图片也换外国女孩",
    );
}

/// The same story translated alone, no image model: whether a long edit's
/// arguments stream when no picture is asked for with it.
#[test]
#[ignore = "live: calls the model"]
fn translate_a_story() {
    run_on(
        include_str!("fixtures/borrowing-rain.md"),
        None,
        AgentMode::Write,
        ThinkingLevel::Auto,
        "翻译为英文",
    );
}
