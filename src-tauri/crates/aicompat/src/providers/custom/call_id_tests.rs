use super::*;

fn chunk(tc: Value) -> String {
    json!({"choices": [{"delta": {"tool_calls": [tc]}}]}).to_string()
}

#[test]
fn a_reused_or_missing_call_id_gets_one_of_its_own() {
    let history = vec![AgentTurn::ToolCall {
        call_id: "call_0".into(),
        name: "propose_edit".into(),
        arguments: "{}".into(),
        reasoning: None,
    }];
    let seen = std::sync::Mutex::new(Vec::new());
    let sink = |e: ProviderEvent<'_>| {
        if let ProviderEvent::ToolStart { call_id, .. } | ProviderEvent::ToolArgs { call_id, .. } =
            e
        {
            seen.lock().unwrap().push(call_id.to_string());
        }
    };
    let mut acc = ChatStreamAccumulator {
        ids: CallIds::from_history(&history),
        ..Default::default()
    };
    // The id the last reply's call had, then a call with none.
    acc.apply(&chunk(json!({"index": 0, "id": "call_0", "function": {"name": "propose_edit", "arguments": ""}})), &sink);
    acc.apply(
        &chunk(json!({"index": 0, "function": {"arguments": "{}"}})),
        &sink,
    );
    acc.apply(
        &chunk(json!({"index": 1, "function": {"name": "propose_edit", "arguments": "{}"}})),
        &sink,
    );
    let StepResult::ToolCalls(calls) = acc.into_step_result(&|_| {}) else {
        panic!("calls");
    };
    let ids: Vec<String> = calls
        .iter()
        .filter_map(|c| match c {
            AgentTurn::ToolCall { call_id, .. } => Some(call_id.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(ids, ["call_0~2", "call_1"]);
    // The stream named them as the result does.
    let seen = seen.into_inner().unwrap();
    assert!(
        seen.iter().all(|id| id == "call_0~2" || id == "call_1"),
        "{seen:?}"
    );
}
