use super::*;
use serde_json::json;
use std::sync::Mutex;

fn call(id: &str, name: &str, arguments: Value) -> AgentTurn {
    AgentTurn::ToolCall {
        call_id: id.into(),
        name: name.into(),
        arguments: arguments.to_string(),
        reasoning: None,
    }
}

fn result(id: &str, output: &str) -> AgentTurn {
    AgentTurn::ToolResult {
        call_id: id.into(),
        output: output.into(),
        images: Vec::new(),
    }
}

fn ids(turns: &[AgentTurn]) -> Vec<String> {
    turns
        .iter()
        .map(|t| match t {
            AgentTurn::ToolCall { call_id, .. } => format!("call {call_id}"),
            AgentTurn::ToolResult { call_id, .. } => format!("result {call_id}"),
            _ => "other".into(),
        })
        .collect()
}

#[test]
fn a_list_call_is_one_call_per_item_and_joins_back_as_the_model_wrote_it() {
    let edits = json!({"edits": [
        {"action": "replace", "block": "a", "text": "One."},
        {"action": "replace", "block": "b", "text": "Two."}
    ]});
    let StepResult::ToolCalls(split) = split_calls(StepResult::ToolCalls(vec![
        call("c1", "propose_edit", edits.clone()),
        call("c2", "read_file", json!({"path": "x"})),
    ])) else {
        panic!("calls");
    };
    assert_eq!(ids(&split), ["call c1#0", "call c1#1", "call c2"]);
    let AgentTurn::ToolCall { arguments, .. } = &split[1] else {
        panic!()
    };
    assert_eq!(
        serde_json::from_str::<Value>(arguments).unwrap(),
        json!({"action": "replace", "block": "b", "text": "Two."})
    );

    // As the loop records them: the calls, then each one's result.
    let mut turns = split;
    turns.extend([
        result("c1#0", "Edit proposed. [accepted]"),
        result("c1#1", "Not proposed: no block b."),
        result("c2", "file"),
    ]);
    let joined = join_calls(&turns);
    assert_eq!(
        ids(&joined),
        ["call c1", "call c2", "result c1", "result c2"]
    );
    let AgentTurn::ToolCall { arguments, .. } = &joined[0] else {
        panic!()
    };
    assert_eq!(serde_json::from_str::<Value>(arguments).unwrap(), edits);
    let AgentTurn::ToolResult { output, .. } = &joined[2] else {
        panic!()
    };
    assert_eq!(
        output,
        "1. Edit proposed. [accepted]\n2. Not proposed: no block b."
    );
}

#[test]
fn a_call_without_its_list_stays_as_it_came() {
    let single = call(
        "c1",
        "add_comment",
        json!({"block": "a", "comment": "Why?"}),
    );
    let StepResult::ToolCalls(split) = split_calls(StepResult::ToolCalls(vec![single.clone()]))
    else {
        panic!()
    };
    assert_eq!(ids(&split), ["call c1"]);
    assert_eq!(ids(&join_calls(&split)), ["call c1"]);
}

/// The events a stream of `deltas` for list call `c1` gives, as strings.
fn streamed(tool: &str, deltas: &[&str]) -> Vec<String> {
    let stream = ListStream::default();
    let seen = Mutex::new(Vec::new());
    let out = |e: ProviderEvent<'_>| {
        seen.lock().unwrap().push(match e {
            ProviderEvent::ToolStart { call_id, name } => format!("start {call_id} {name}"),
            ProviderEvent::ToolArgs { call_id, delta } => format!("{call_id}: {delta}"),
            ProviderEvent::Text(t) => format!("text {t}"),
            _ => "other".into(),
        })
    };
    stream.feed(
        ProviderEvent::ToolStart {
            call_id: "c1",
            name: tool,
        },
        &out,
    );
    for delta in deltas {
        stream.feed(
            ProviderEvent::ToolArgs {
                call_id: "c1",
                delta,
            },
            &out,
        );
    }
    seen.into_inner().unwrap()
}

#[test]
fn each_item_streams_as_a_call_of_its_own() {
    let events = streamed(
        "add_comment",
        &[
            r#"{"comm"#,
            r#"ents": [{"block": "a", "#,
            r#""comment": "Why {so} \"this\"?"}, {"blo"#,
            r#"ck": "b", "comment": "Hm"}]}"#,
        ],
    );
    assert_eq!(
        events,
        [
            "start c1#0 add_comment",
            r#"c1#0: {"block": "a", "#,
            r#"c1#0: "comment": "Why {so} \"this\"?"}"#,
            "start c1#1 add_comment",
            r#"c1#1: {"blo"#,
            r#"c1#1: ck": "b", "comment": "Hm"}"#,
        ]
    );
    // Put together, each item's pieces are its JSON.
    let first: String = events
        .iter()
        .filter_map(|e| e.strip_prefix("c1#0: "))
        .collect();
    assert_eq!(
        serde_json::from_str::<Value>(&first).unwrap(),
        json!({"block": "a", "comment": "Why {so} \"this\"?"})
    );
}

#[test]
fn other_calls_and_text_pass_through() {
    let stream = ListStream::default();
    let seen = Mutex::new(Vec::new());
    let out = |e: ProviderEvent<'_>| {
        seen.lock().unwrap().push(match e {
            ProviderEvent::ToolStart { call_id, .. } => format!("start {call_id}"),
            ProviderEvent::ToolArgs { call_id, delta } => format!("{call_id}: {delta}"),
            ProviderEvent::Text(t) => format!("text {t}"),
            _ => "other".into(),
        })
    };
    stream.feed(ProviderEvent::Text("Hi"), &out);
    stream.feed(
        ProviderEvent::ToolStart {
            call_id: "r",
            name: "read_file",
        },
        &out,
    );
    stream.feed(
        ProviderEvent::ToolArgs {
            call_id: "r",
            delta: "{}",
        },
        &out,
    );
    assert_eq!(seen.into_inner().unwrap(), ["text Hi", "start r", "r: {}"]);
}
