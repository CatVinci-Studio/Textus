use super::*;
use serde_json::json;

/// The pieces of `text` streamed in chunks of `size` bytes (on char
/// boundaries), adjacent texts and bodies joined.
fn streamed(text: &str, size: usize) -> Vec<Piece> {
    let mut splitter = TagSplitter::default();
    let mut out: Vec<Piece> = Vec::new();
    let mut rest = text;
    while !rest.is_empty() {
        let mut cut = size.min(rest.len());
        while !rest.is_char_boundary(cut) {
            cut += 1;
        }
        out.extend(splitter.push(&rest[..cut]));
        rest = &rest[cut..];
    }
    out.extend(splitter.finish());
    let mut joined: Vec<Piece> = Vec::new();
    for piece in out {
        match (joined.last_mut(), piece) {
            (Some(Piece::Text(a)), Piece::Text(b)) => a.push_str(&b),
            (Some(Piece::Body { index: i, text: a }), Piece::Body { index: j, text: b })
                if *i == j =>
            {
                a.push_str(&b)
            }
            (_, piece) => joined.push(piece),
        }
    }
    joined
}

fn attrs(pairs: &[(&str, &str)]) -> Attrs {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

const REPLY: &str = "Tightened both paragraphs.\n\n<textus-edit block=\"b3\">\n“Sound.”\n</textus-edit>\n\n<textus-edit block=\"b8\" to=\"b9\">\nShe touched the cloth.\n\nIt was warm.\n</textus-edit>";

#[test]
fn a_reply_splits_the_same_however_it_streams() {
    let want = vec![
        Piece::Text("Tightened both paragraphs.\n\n".into()),
        Piece::Open {
            index: 0,
            attrs: attrs(&[("block", "b3")]),
        },
        Piece::Body {
            index: 0,
            text: "“Sound.”".into(),
        },
        Piece::Close { index: 0 },
        Piece::Text("\n\n".into()),
        Piece::Open {
            index: 1,
            attrs: attrs(&[("block", "b8"), ("to", "b9")]),
        },
        Piece::Body {
            index: 1,
            text: "She touched the cloth.\n\nIt was warm.".into(),
        },
        Piece::Close { index: 1 },
    ];
    for size in [1, 2, 3, 5, 7, 13, 64, 4096] {
        assert_eq!(streamed(REPLY, size), want, "chunks of {size}");
    }
}

#[test]
fn nothing_outside_a_tag_is_held_back_but_what_may_start_one() {
    let mut splitter = TagSplitter::default();
    assert_eq!(
        splitter.push("Done. <text"),
        vec![Piece::Text("Done. ".into())]
    );
    // Not the tag after all.
    assert_eq!(
        splitter.push("ile> stays"),
        vec![Piece::Text("<textile> stays".into())]
    );
    let mut splitter = TagSplitter::default();
    assert_eq!(
        splitter.push("see <textus-editor> here"),
        vec![Piece::Text("see <textus-editor> here".into())]
    );
}

#[test]
fn a_body_streams_before_its_tag_closes() {
    let mut splitter = TagSplitter::default();
    let pieces = splitter.push("<textus-edit block=\"k3f9\">\nFirst line\nsecond");
    assert_eq!(
        pieces.last(),
        Some(&Piece::Body {
            index: 0,
            text: "First line\nsecond".into()
        })
    );
    // A line break may be the one before the closing tag: held.
    assert_eq!(splitter.push("\n"), vec![]);
    assert_eq!(
        splitter.push("third</textus-edit>"),
        vec![
            Piece::Body {
                index: 0,
                text: "\nthird".into()
            },
            Piece::Close { index: 0 }
        ]
    );
}

#[test]
fn tags_are_read_loosely() {
    // On one line with its text, single quotes, no quotes, shorthand.
    let (reply, tags) = split_reply(
        "Fixed.\n<textus-edit block='b3'>“Sound.”</textus-edit>\n<textus-edit after=b19>Next day.</textus-edit>",
    );
    assert_eq!(reply, "Fixed.");
    assert_eq!(tags[0], (attrs(&[("block", "b3")]), "“Sound.”".into()));
    assert_eq!(tags[1].0, attrs(&[("after", "b19")]));
    // Left open at the end: closes there.
    let (_, tags) = split_reply("Done.\n<textus-edit block=\"b2\">\nAll of it");
    assert_eq!(tags, vec![(attrs(&[("block", "b2")]), "All of it".into())]);
    // A `>` inside a quoted attribute doesn't end the tag.
    let (_, tags) = split_reply("<textus-edit block=\"b1\" quote=\"a > b\">c</textus-edit>");
    assert_eq!(tags[0].0["quote"], "a > b");
}

#[test]
fn code_and_html_in_a_body_stay_as_written() {
    let body = "```diff\n@@ -1 +1 @@\n-<edit>old</edit>\n+<edit>new</edit>\n```";
    let (_, tags) = split_reply(&format!(
        "<textus-edit block=\"b7\">\n{body}\n</textus-edit>"
    ));
    assert_eq!(tags[0].1, body);
}

fn args(call: &str) -> serde_json::Value {
    serde_json::from_str(call).unwrap()
}

#[test]
fn each_tag_becomes_the_propose_edit_it_stands_for() {
    let replace = args(&edit_call(
        &attrs(&[("block", "[#b8]"), ("to", "#b9")]),
        "New.",
    ));
    assert_eq!(replace["action"], "replace");
    assert_eq!(replace["block"], "b8");
    assert_eq!(replace["last_block"], "b9");
    assert_eq!(replace["text"], "New.");
    let after = args(&edit_call(
        &attrs(&[("block", "b4"), ("action", "after")]),
        "More.",
    ));
    assert_eq!(after["action"], "insert_after");
    assert_eq!(after["block"], "b4");
    // After a run: after its last block.
    let after_run = args(&edit_call(
        &attrs(&[("block", "b4"), ("to", "b6"), ("action", "after")]),
        "x",
    ));
    assert_eq!(after_run["block"], "b6");
    assert!(after_run.get("last_block").is_none());
    let before = args(&edit_call(&attrs(&[("before", "b6")]), "Earlier."));
    assert_eq!(
        (before["action"].as_str(), before["block"].as_str()),
        (Some("insert_before"), Some("b6"))
    );
    let delete = args(&edit_call(&attrs(&[("block", "b2")]), ""));
    assert_eq!(delete["action"], "delete");
    let quoted = args(&edit_call(
        &attrs(&[("block", "b4"), ("quote", "竹骨")]),
        "伞骨",
    ));
    assert_eq!(quoted["anchor"], "竹骨");
    assert_eq!(quoted["tag_text"], "伞骨");
    let append = args(&edit_call(&attrs(&[("action", "append")]), "The end."));
    assert_eq!(append["action"], "append");
    assert!(append.get("block").is_none());
}

#[test]
fn a_tag_spells_the_spaces_a_model_cant_type() {
    let call = args(&edit_call(
        &attrs(&[("block", "b1")]),
        "Vraiment&#8239;? Oui&nbsp;!",
    ));
    assert_eq!(call["text"], "Vraiment\u{202f}? Oui\u{a0}!");
    assert_eq!(spaces("&amp; &lt;"), "&amp; &lt;");
}

#[test]
fn streamed_arguments_join_into_the_whole_call() {
    let tag = attrs(&[("block", "b3"), ("quote", "say \"no\"")]);
    let body = "Line \"one\"\n\\two";
    let joined = format!(
        "{}{}{}{}",
        args_head(&tag),
        args_piece("Line \"one\"\n"),
        args_piece("\\two"),
        ARGS_TAIL
    );
    let mut whole = args(&edit_call(&tag, body));
    whole.as_object_mut().unwrap().remove("tag_text");
    assert_eq!(args(&joined), whole);
}

#[test]
fn a_step_with_tags_proposes_them_after_its_own_calls() {
    let StepResult::ToolCalls(calls) = with_tag_edits(StepResult::Done(REPLY.into()), 4) else {
        panic!("expected calls");
    };
    assert!(
        matches!(&calls[0], AgentTurn::Assistant { text, .. } if text == "Tightened both paragraphs.")
    );
    let ids: Vec<&str> = calls
        .iter()
        .filter_map(|c| match c {
            AgentTurn::ToolCall { call_id, name, .. } if name == EDIT_TOOL => {
                Some(call_id.as_str())
            }
            _ => None,
        })
        .collect();
    assert_eq!(ids, vec![call_id(4, 0).as_str(), call_id(4, 1).as_str()]);
    // Without tags, as it was.
    assert!(
        matches!(with_tag_edits(StepResult::Done("Hi.".into()), 1), StepResult::Done(t) if t == "Hi.")
    );
    // Beside a real call: the reply loses its tags, the calls stay first.
    let step = StepResult::ToolCalls(vec![
        AgentTurn::assistant("Noted and fixed.\n<textus-edit block=\"b1\">A.</textus-edit>"),
        AgentTurn::ToolCall {
            call_id: "c1".into(),
            name: "add_comment".into(),
            arguments: "{}".into(),
            reasoning: None,
        },
    ]);
    let StepResult::ToolCalls(calls) = with_tag_edits(step, 2) else {
        panic!("expected calls");
    };
    assert!(matches!(&calls[0], AgentTurn::Assistant { text, .. } if text == "Noted and fixed."));
    assert!(matches!(&calls[1], AgentTurn::ToolCall { call_id, .. } if call_id == "c1"));
    assert!(matches!(&calls[2], AgentTurn::ToolCall { call_id, .. } if is_virtual(call_id)));
}

#[test]
fn the_model_sees_its_tags_again_and_what_came_of_them() {
    let call = |n: usize, block: &str, text: &str| AgentTurn::ToolCall {
        call_id: call_id(0, n),
        name: EDIT_TOOL.into(),
        arguments: edit_call(&attrs(&[("block", block)]), text),
        reasoning: None,
    };
    let result = |n: usize, output: &str| AgentTurn::ToolResult {
        call_id: call_id(0, n),
        output: output.into(),
        images: Vec::new(),
    };
    let user = |text: &str| AgentTurn::User {
        text: text.into(),
        images: Vec::new(),
    };
    let history = vec![
        user("Tighten b3 and b8."),
        call(0, "b3", "“Sound.”"),
        call(1, "b8", "She touched it."),
        result(0, "Edit proposed. [accepted]"),
        result(1, "Not proposed: no block has the id `b8`."),
    ];
    // In the request: the tag to send again is told in a message of its own.
    let seen = model_view(history.clone());
    assert!(matches!(&seen[1], AgentTurn::Assistant { text, .. }
        if text == "<textus-edit block=\"b3\">\n“Sound.”\n</textus-edit>\n\n<textus-edit block=\"b8\">\nShe touched it.\n</textus-edit>"));
    assert!(matches!(&seen[2], AgentTurn::User { text, .. }
        if text.contains("1. Edit proposed. [accepted]") && text.contains("2. Not proposed")));
    assert_eq!(seen.len(), 3);
    // Settled, with its reply, and the user's next message after.
    let mut later = history;
    later.push(AgentTurn::assistant("Tightened both."));
    later.push(user("Now b9."));
    let seen = model_view(later);
    assert!(matches!(&seen[1], AgentTurn::Assistant { text, .. }
        if text.starts_with("Tightened both.\n\n<textus-edit block=\"b3\">")));
    assert!(matches!(&seen[2], AgentTurn::User { text, .. }
        if text.starts_with("(Textus, on the edits") && text.ends_with("Now b9.")));
    assert_eq!(seen.len(), 3);
    // A quoted change is shown with its own words, not the whole block.
    let quoted = AgentTurn::ToolCall {
        call_id: call_id(1, 0),
        name: EDIT_TOOL.into(),
        arguments: {
            let mut a = args(&edit_call(
                &attrs(&[("block", "b4"), ("quote", "竹骨")]),
                "伞骨",
            ));
            a["text"] = json!("小满张伞，细察其面与伞骨。");
            a.to_string()
        },
        reasoning: None,
    };
    let seen = model_view(vec![quoted]);
    assert!(matches!(&seen[0], AgentTurn::Assistant { text, .. }
        if text == "<textus-edit block=\"b4\" quote=\"竹骨\">\n伞骨\n</textus-edit>"));
}
