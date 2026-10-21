//! Live checks of a conversation that goes on before the user decides:
//! messages sent while the last one's proposals are still undecided - typed
//! on, or queued while it was writing (src/ai/chat/MessageQueue.tsx). Each
//! later request works on the document as the user sees it: an edit of the
//! undecided text goes into that proposal (tools.rs's quotes_undecided, the
//! frontend's joinEdit), and the one Accept at the end takes it all.
//!
//! On Claude (ANTHROPIC_API_KEY), or TEXTUS_EVAL_PROVIDER's model. Run from
//! src-tauri/:
//!   cargo test --lib live_eval::continuing -- --ignored --nocapture --test-threads=1

use super::harness::{self, auth, AgentSetup, Conversation, UserTurn};
use crate::ai::agent::AgentMode;
use crate::ai::images::ImageRun;
use crate::ai::workspace;

fn run(mode: AgentMode, ui: &str, doc: &str, script: &[UserTurn]) -> Option<Conversation> {
    run_with(mode, ui, doc, script, None)
}

fn run_with(
    mode: AgentMode,
    ui: &str,
    doc: &str,
    script: &[UserTurn],
    pictures: Option<&ImageRun>,
) -> Option<Conversation> {
    let Some(auth) = auth() else {
        eprintln!("live_eval: no ANTHROPIC_API_KEY - skipping");
        return None;
    };
    let ws = workspace::load_layers(None, None, None, &[]);
    let model = harness::agent_model();
    let setup = AgentSetup {
        model: &model,
        mode,
        workspace: &ws,
        focus_heading: None,
        ui_language: ui,
        thinking: aicompat::capabilities::ThinkingLevel::Auto,
        pictures,
    };
    let conv = harness::run_conversation(&auth, &setup, doc, script);
    assert!(conv.error.is_none(), "{:?}", conv.error);
    for (i, outcome) in conv.outcomes.iter().enumerate() {
        eprintln!(
            "live_eval: turn {}: {} proposals, {} joined, {} refused {:?}\n  reply: {}",
            i + 1,
            outcome.proposals.len(),
            outcome.joined,
            outcome.invalid_proposals,
            outcome.invalid_errors,
            harness::clip(&outcome.reply, 200)
        );
        if let Some(e) = &outcome.apply_error {
            eprintln!("live_eval: turn {}: apply failed: {e}", i + 1);
        }
    }
    eprintln!(
        "live_eval: final document:\n{}",
        conv.outcomes.last().map(|o| o.doc_after.as_str()).unwrap_or("")
    );
    Some(conv)
}

/// What every case asks: no refused proposal, no edit that couldn't be
/// applied, and the final document has the change asked for.
fn settled(conv: &Conversation) -> &str {
    for (i, outcome) in conv.outcomes.iter().enumerate() {
        assert_eq!(
            outcome.invalid_proposals,
            0,
            "turn {}: refused {:?}",
            i + 1,
            outcome.invalid_errors
        );
        assert!(
            outcome.apply_error.is_none(),
            "turn {}: {:?}",
            i + 1,
            outcome.apply_error
        );
    }
    &conv.outcomes.last().expect("a turn").doc_after
}

fn paragraphs(doc: &str) -> usize {
    doc.split("\n\n").filter(|p| !p.trim().is_empty()).count()
}

/// Write, then - before deciding - change the second paragraph it wrote.
#[test]
#[ignore = "live API - see module docs"]
fn a_change_to_undecided_writing_goes_into_it() {
    for (ui, first, second) in [
        (
            "zh",
            "写两段关于港口清晨的短文，每段两三句。",
            "把第二段改得更有画面感一些。",
        ),
        (
            "en",
            "Write two short paragraphs about a harbour at dawn, two or three sentences each.",
            "Make the second paragraph more vivid.",
        ),
    ] {
        let Some(conv) = run(
            AgentMode::Write,
            ui,
            "",
            &[UserTurn::leaving(first), UserTurn::new(second)],
        ) else {
            return;
        };
        let written = &conv.outcomes[0];
        assert!(!written.proposals.is_empty(), "{ui}: nothing written");
        let changed = &conv.outcomes[1];
        assert!(
            changed.joined >= 1,
            "{ui}: the change didn't go into the writing ({} standing)",
            changed.proposals.len()
        );
        let doc = settled(&conv);
        // Two paragraphs still, the second one changed: not a second copy.
        assert_eq!(paragraphs(doc), 2, "{ui}: {doc}");
        assert_ne!(doc, conv.outcomes[0].doc_after, "{ui}: nothing changed");
    }
}

/// Write, then - before deciding - ask for more: it goes on after the
/// undecided text, not before it.
#[test]
#[ignore = "live API - see module docs"]
fn more_writing_follows_the_undecided_text() {
    for (ui, first, more) in [
        ("zh", "写一段关于秋天果园的短文。", "再接着写一段，讲傍晚收工。"),
        (
            "en",
            "Write a paragraph about an orchard in autumn.",
            "Now write another paragraph after it, about the end of the day's picking.",
        ),
    ] {
        let Some(conv) = run(
            AgentMode::Write,
            ui,
            "",
            &[UserTurn::leaving(first), UserTurn::new(more)],
        ) else {
            return;
        };
        let doc = settled(&conv);
        assert!(paragraphs(doc) >= 2, "{ui}: {doc}");
        // The first request's text comes first.
        let first_text = conv.outcomes[0]
            .turns
            .iter()
            .find_map(|t| match t {
                aicompat::agent::AgentTurn::ToolCall { name, arguments, .. }
                    if name == "propose_edit" =>
                {
                    serde_json::from_str::<serde_json::Value>(arguments)
                        .ok()?
                        .get("text")?
                        .as_str()
                        .map(|s| s.chars().take(12).collect::<String>())
                }
                _ => None,
            })
            .unwrap_or_default();
        let at = doc.find(&first_text);
        assert_eq!(at.map(|a| a < doc.len() / 2), Some(true), "{ui}: {doc}");
    }
}

/// Revise, three requests on one passage before deciding: rewrite, then
/// shorter, then one word changed - each on the last undecided version.
#[test]
#[ignore = "live API - see module docs"]
fn revisions_on_an_undecided_revision_build_on_it() {
    let doc = "港口在清晨显得格外安静。几条渔船靠在码头边上，船身随着海浪轻轻晃动，偶尔有一两只海鸥从水面掠过，发出几声清脆的叫声。远处的灯塔还亮着，光在薄雾里显得有些模糊。\n\n到了中午，码头上开始热闹起来。";
    let Some(conv) = run(
        AgentMode::Revise,
        "zh",
        doc,
        &[
            UserTurn::leaving("把第一段改得更简洁。"),
            UserTurn::leaving("再短一点，两句话。"),
            UserTurn::new("把“灯塔”换成“航标灯”。"),
        ],
    ) else {
        return;
    };
    assert!(
        conv.outcomes[1].joined + conv.outcomes[2].joined >= 1,
        "no later request edited the undecided revision"
    );
    let doc = settled(&conv);
    assert!(doc.contains("到了中午"), "the second paragraph went: {doc}");
    let first = doc.split("\n\n").next().unwrap_or("");
    assert!(first.chars().count() < 70, "not shorter: {first}");
    assert!(!first.contains("灯塔") || first.contains("航标灯"), "{first}");
}

/// A picture asked for with the writing, both undecided, then the
/// writing rewritten: one picture in the end, with its paragraph.
#[test]
#[ignore = "live API - see module docs"]
fn an_undecided_picture_survives_a_rewrite_of_its_text() {
    let pictures = ImageRun::offline(2);
    let Some(conv) = run_with(
        AgentMode::Write,
        "zh",
        "",
        &[
            UserTurn::leaving("写两段关于海边小镇的短文，并配一张图。"),
            UserTurn::new("把第一段改写得更有画面感。"),
        ],
        Some(&pictures),
    ) else {
        return;
    };
    let doc = settled(&conv);
    assert_eq!(
        doc.matches("textus-generated:").count(),
        1,
        "the picture isn't in once: {doc}"
    );
}
