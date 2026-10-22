
use super::*;
use crate::agent::ImageAttachment;

#[test]
fn turns_to_messages_maps_plain_turns_1_to_1() {
    let history = vec![
        AgentTurn::User {
            text: "hi".to_string(),
            images: Vec::new(),
        },
        AgentTurn::assistant("hello".to_string()),
    ];
    let messages = turns_to_messages(&history);
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["role"], "user");
    assert_eq!(messages[0]["content"], "hi");
    assert_eq!(messages[1]["role"], "assistant");
    assert_eq!(messages[1]["content"], "hello");
}

#[test]
fn turns_to_messages_skips_empty_assistant_turns() {
    let history = vec![
        AgentTurn::User {
            text: "hi".to_string(),
            images: Vec::new(),
        },
        AgentTurn::assistant(" ".to_string()),
        AgentTurn::User {
            text: "again".to_string(),
            images: Vec::new(),
        },
    ];
    let messages = turns_to_messages(&history);
    assert_eq!(messages.len(), 2);
    assert!(messages.iter().all(|m| m["role"] == "user"));
}

/// Two things worth pinning: the base64 source shape Claude requires,
/// and that a text-only turn keeps its plain-string `content`. The
/// second matters because it is the shape every request had before
/// images existed - regressing it would change every conversation, not
/// just the ones with a picture in them.
#[test]
fn images_use_the_base64_source_block_and_text_only_turns_stay_strings() {
    let with_image = turns_to_messages(&[AgentTurn::User {
        text: "what is this?".to_string(),
        images: vec![ImageAttachment {
            name: "chart.png".to_string(),
            mime: "image/png".to_string(),
            data_base64: "AAAA".to_string(),
        }],
    }]);
    assert_eq!(with_image[0]["content"][0]["type"], "image");
    assert_eq!(with_image[0]["content"][0]["source"]["type"], "base64");
    assert_eq!(
        with_image[0]["content"][0]["source"]["media_type"],
        "image/png"
    );
    assert_eq!(with_image[0]["content"][0]["source"]["data"], "AAAA");
    assert_eq!(with_image[0]["content"][1]["text"], "what is this?");

    let text_only = turns_to_messages(&[AgentTurn::User {
        text: "hi".to_string(),
        images: Vec::new(),
    }]);
    assert_eq!(text_only[0]["content"], "hi");
}

fn user(text: &str) -> AgentTurn {
    AgentTurn::User {
        text: text.to_string(),
        images: Vec::new(),
    }
}

fn call(id: &str, query: &str) -> AgentTurn {
    AgentTurn::ToolCall {
        call_id: id.to_string(),
        name: "search_document".to_string(),
        arguments: format!("{{\"query\":\"{query}\"}}"),
        reasoning: None,
    }
}

fn result(id: &str, output: &str) -> AgentTurn {
    AgentTurn::ToolResult {
        call_id: id.to_string(),
        output: output.to_string(),
        images: Vec::new(),
    }
}

fn assistant(text: &str) -> AgentTurn {
    AgentTurn::assistant(text.to_string())
}

/// Messages takes image blocks inside a tool_result, so a tool's
/// images stay with its text - no extra user message.
#[test]
fn tool_result_images_ride_inside_the_tool_result() {
    let history = vec![
        call("v", "map"),
        AgentTurn::ToolResult {
            call_id: "v".to_string(),
            output: "Here is map.png.".to_string(),
            images: vec![ImageAttachment {
                name: "map.png".to_string(),
                mime: "image/png".to_string(),
                data_base64: "AAAA".into(),
            }],
        },
        result("w", "plain"),
    ];
    let messages = turns_to_messages(&history);
    assert_eq!(messages.len(), 2);
    let results = messages[1]["content"].as_array().unwrap();
    let blocks = results[0]["content"].as_array().unwrap();
    assert_eq!(blocks[0]["text"], "Here is map.png.");
    assert_eq!(blocks[1]["type"], "image");
    assert_eq!(blocks[1]["source"]["media_type"], "image/png");
    assert_eq!(blocks[1]["source"]["data"], "AAAA");
    // A result without images keeps the plain string.
    assert_eq!(results[1]["content"], "plain");
}

#[test]
fn turns_to_messages_groups_each_steps_tool_calls_into_one_pair() {
    // run_agent_loop records a step as Call1, Call2, Result1, Result2:
    // that step must become exactly one assistant message (both tool_use
    // blocks) followed by one user message (both tool_result blocks), or
    // Claude rejects the request for having consecutive assistant
    // messages. Call3, after a result, is the next step's own pair.
    let history = vec![
        user("do it"),
        call("1", "a"),
        call("2", "b"),
        result("1", "found a"),
        result("2", "found b"),
        call("3", "c"),
        result("3", "found c"),
        assistant("done"),
    ];

    let messages = turns_to_messages(&history);
    // user, assistant(tool_use x2), user(tool_result x2),
    // assistant(tool_use), user(tool_result), assistant
    assert_eq!(messages.len(), 6);

    assert_eq!(messages[1]["role"], "assistant");
    let tool_uses = messages[1]["content"].as_array().unwrap();
    assert_eq!(tool_uses.len(), 2);
    assert_eq!(tool_uses[0]["type"], "tool_use");
    assert_eq!(tool_uses[0]["id"], "1");
    assert_eq!(tool_uses[0]["input"]["query"], "a");
    assert_eq!(tool_uses[1]["id"], "2");

    assert_eq!(messages[2]["role"], "user");
    let tool_results = messages[2]["content"].as_array().unwrap();
    assert_eq!(tool_results.len(), 2);
    assert_eq!(tool_results[0]["type"], "tool_result");
    assert_eq!(tool_results[0]["tool_use_id"], "1");
    assert_eq!(tool_results[0]["content"], "found a");
    assert_eq!(tool_results[1]["tool_use_id"], "2");

    assert_eq!(messages[3]["content"][0]["id"], "3");
    assert_eq!(messages[4]["content"][0]["tool_use_id"], "3");
    assert_eq!(messages[5]["role"], "assistant");
    assert_eq!(messages[5]["content"], "done");
}

/// Saved before the loop recorded calls first: Call1, Result1, Call2,
/// Result2. Each call becomes its own pair - still one result per call
/// in the message right after it, so the API accepts it.
#[test]
fn interleaved_history_replays_as_one_pair_per_call() {
    let history = vec![
        user("do it"),
        call("1", "a"),
        result("1", "found a"),
        call("2", "b"),
        result("2", "found b"),
        assistant("done"),
    ];
    let roles: Vec<_> = turns_to_messages(&history)
        .iter()
        .map(|m| m["role"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        roles,
        [
            "user",
            "assistant",
            "user",
            "assistant",
            "user",
            "assistant"
        ]
    );
}

fn api_key() -> AnthropicAuth {
    AnthropicAuth::ApiKey("k".to_string())
}

fn body(history: &[AgentTurn]) -> Value {
    agent_request_body(
        &api_key(),
        "rules",
        history,
        &[],
        false,
        &Thinking::default(),
        "m",
    )
    .0
}

/// Where the request's cache_control markers sit, as "system/i" and
/// "messages/i" paths - the top-level automatic one is not listed.
fn breakpoints(body: &Value) -> Vec<String> {
    let mut found = Vec::new();
    for section in ["system", "messages"] {
        for (i, item) in body[section].as_array().unwrap().iter().enumerate() {
            let blocks = match section {
                "system" => vec![item.clone()],
                _ => item["content"].as_array().cloned().unwrap_or_default(),
            };
            if blocks.iter().any(|b| b.get("cache_control").is_some()) {
                found.push(format!("{section}/{i}"));
            }
        }
    }
    found
}

/// The prompt a request sends, without its cache markers: a marked
/// message's one text block is the plain string it was before marking.
fn prompt_of(messages: &[Value]) -> Vec<Value> {
    messages
        .iter()
        .map(|m| {
            let mut m = m.clone();
            if let Some(blocks) = m["content"].as_array_mut() {
                for block in blocks.iter_mut() {
                    block.as_object_mut().unwrap().remove("cache_control");
                }
                if let [only] = blocks.as_slice() {
                    if only["type"] == "text" && only.as_object().unwrap().len() == 2 {
                        m["content"] = only["text"].clone();
                    }
                }
            }
            m
        })
        .collect()
}

#[test]
fn the_request_marks_the_system_prompt_and_the_history_for_caching() {
    // First message: only the system prompt has a history-independent
    // breakpoint; the automatic one covers the rest.
    let first = body(&[user("doc + q1")]);
    assert_eq!(breakpoints(&first), ["system/0"]);
    assert_eq!(first["cache_control"]["type"], "ephemeral");

    // Second: the end of the history too - not the message being sent,
    // which carries the document and is never sent again as it is.
    let second = body(&[user("q1"), assistant("a1"), user("doc + q2")]);
    assert_eq!(breakpoints(&second), ["system/0", "messages/1"]);

    // Third: also the end of the history before the newest exchange.
    // Three explicit markers and the automatic one: the API's limit.
    let third = body(&[
        user("q1"),
        assistant("a1"),
        user("q2"),
        call("1", "a"),
        result("1", "found"),
        assistant("a2"),
        user("doc + q3"),
    ]);
    assert_eq!(
        breakpoints(&third),
        ["system/0", "messages/1", "messages/5"]
    );
    assert!(third["messages"][6]["content"].is_string());

    // An OAuth request's identity block comes first; the marker stays
    // on the last block, so it still covers the whole system prompt.
    let oauth = agent_request_body(
        &AnthropicAuth::Oauth("t".to_string()),
        "rules",
        &[user("q")],
        &[],
        false,
        &Thinking::default(),
        "m",
    )
    .0;
    assert_eq!(breakpoints(&oauth), ["system/1"]);
}

/// The property the breakpoints rely on, through a whole conversation:
/// each tool step's prompt starts with the step before it, and each
/// exchange's starts with the previous exchange's up to the block that
/// one marked as the end of its history - so every request reads what
/// the one before it wrote.
#[test]
fn every_request_starts_with_what_the_one_before_it_cached() {
    let prompt = |request: &Value| prompt_of(request["messages"].as_array().unwrap());
    // What run_agent_loop sends: the history, the current message with
    // the document, then each step's calls and results.
    let exchange = |history: &[AgentTurn], sent: &str, steps: &[&[AgentTurn]]| {
        let mut turns = history.to_vec();
        turns.push(user(sent));
        let mut requests = vec![body(&turns)];
        for step in steps {
            turns.extend(step.iter().cloned());
            requests.push(body(&turns));
        }
        requests
    };
    let read_then_edit: [&[AgentTurn]; 2] = [
        &[
            call("r1", "a"),
            call("r2", "b"),
            result("r1", "x"),
            result("r2", "y"),
        ],
        &[call("e", "c"), result("e", "Edit proposed")],
    ];
    let first = exchange(&[], "doc + q1", &read_then_edit);
    for step in first.windows(2) {
        let (before, after) = (prompt(&step[0]), prompt(&step[1]));
        assert_eq!(after[..before.len()], before[..]);
        assert_eq!(step[0]["system"], step[1]["system"]);
    }
    // The edit step's pair is its own: the read step's stays as it was.
    assert_eq!(prompt(&first[2]).len(), 5);

    // History keeps each message without its document (agent.rs).
    let mut history = vec![user("q1")];
    history.extend(read_then_edit.iter().flat_map(|s| s.iter().cloned()));
    history.push(assistant("a1"));
    let second = &exchange(&history, "doc' + q2", &[])[0];
    history.extend([user("q2"), assistant("a2")]);
    let third = &exchange(&history, "doc'' + q3", &[])[0];
    // Exchange 2 marks the end of exchange 1; exchange 3 marks that same
    // block (and the end of exchange 2), so it reads what exchange 2
    // wrote there without relying on the lookback.
    assert_eq!(breakpoints(second), ["system/0", "messages/5"]);
    assert_eq!(breakpoints(third), ["system/0", "messages/5", "messages/7"]);
    assert_eq!(prompt(third)[..=5], prompt(second)[..=5]);
    assert_eq!(second["system"], third["system"]);
    assert_eq!(first[0]["system"], second["system"]);
}

#[test]
fn parse_agent_response_keeps_the_text_after_the_tool_calls() {
    let content = vec![
        json!({"type": "tool_use", "id": "c1", "name": "propose_edit", "input": {"action": "append", "text": "hi"}}),
        json!({"type": "text", "text": "Added a greeting."}),
    ];
    match parse_agent_response(&content, &|_| {}) {
        StepResult::ToolCalls(calls) => {
            assert_eq!(calls.len(), 2);
            assert!(
                matches!(&calls[1], AgentTurn::Assistant { text, .. } if text == "Added a greeting.")
            );
            let AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
                ..
            } = &calls[0]
            else {
                panic!("expected a ToolCall turn");
            };
            assert_eq!(call_id, "c1");
            assert_eq!(name, "propose_edit");
            let parsed: Value = serde_json::from_str(arguments).unwrap();
            assert_eq!(parsed["action"], "append");
        }
        StepResult::Done(_) => panic!("expected tool calls"),
    }
}

/// Feeds SSE data payloads through the accumulator, collecting the
/// events it reports as "T:text", "S:id:name", "A:id:delta" strings.
fn run_stream(events: &[Value]) -> (StreamAccumulator, Vec<String>) {
    let reported = std::sync::Mutex::new(Vec::new());
    let sink = |e: ProviderEvent<'_>| {
        reported.lock().unwrap().push(match e {
            ProviderEvent::Text(t) => format!("T:{t}"),
            ProviderEvent::ToolStart { call_id, name } => format!("S:{call_id}:{name}"),
            ProviderEvent::ToolArgs { call_id, delta } => format!("A:{call_id}:{delta}"),
            ProviderEvent::Thinking(t) => format!("R:{t}"),
            ProviderEvent::Citation { url, .. } => format!("C:{url}"),
        });
    };
    let mut acc = StreamAccumulator::default();
    for event in events {
        acc.apply(&event.to_string(), &sink);
    }
    let reported = reported.into_inner().unwrap();
    (acc, reported)
}

#[test]
fn stream_accumulator_rebuilds_text_and_tool_use_blocks() {
    let (acc, events) = run_stream(&[
        json!({"type": "message_start"}),
        json!({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
        json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "I'll "}}),
        json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "fix that."}}),
        json!({"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "tu_1", "name": "propose_edit"}}),
        json!({"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"action\":"}}),
        json!({"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "\"append\",\"text\":\"hi\"}"}}),
        json!({"type": "content_block_stop", "index": 1}),
        json!({"type": "message_stop"}),
    ]);

    assert_eq!(
        events,
        vec![
            "T:I'll ",
            "T:fix that.",
            "S:tu_1:propose_edit",
            "A:tu_1:{\"action\":",
            "A:tu_1:\"append\",\"text\":\"hi\"}",
        ]
    );

    let content = acc.into_content();
    assert_eq!(
        content[0],
        json!({"type": "text", "text": "I'll fix that."})
    );
    assert_eq!(content[1]["type"], "tool_use");
    assert_eq!(content[1]["input"]["action"], "append");
    // The rebuilt content parses exactly like a non-streamed response.
    match parse_agent_response(&content, &|_| {}) {
        StepResult::ToolCalls(calls) => assert_eq!(calls.len(), 2, "the call, then its text"),
        StepResult::Done(_) => panic!("expected tool calls"),
    }
}

#[test]
fn stream_accumulator_ignores_server_tool_blocks_and_reports_errors() {
    let (acc, events) = run_stream(&[
        json!({"type": "content_block_start", "index": 0, "content_block": {"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search"}}),
        json!({"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}}),
        json!({"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "answer"}}),
        json!({"type": "error", "error": {"type": "overloaded_error", "message": "busy"}}),
        json!({"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "after error, ignored"}}),
    ]);
    assert_eq!(events, vec!["T:answer"]);
    assert!(acc.error.as_deref().unwrap().contains("overloaded_error"));
}

/// Thinking with tools: the stream's thinking blocks (text, signature,
/// encrypted ones) come back on the step's first call exactly as Claude
/// wrote them, and the thinking shows as its own events.
#[test]
fn stream_accumulator_keeps_thinking_blocks_with_their_signatures() {
    let (acc, events) = run_stream(&[
        json!({"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": "", "signature": ""}}),
        json!({"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "Read it "}}),
        json!({"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "first."}}),
        json!({"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "sig-1"}}),
        json!({"type": "content_block_start", "index": 1, "content_block": {"type": "redacted_thinking", "data": "enc"}}),
        json!({"type": "content_block_start", "index": 2, "content_block": {"type": "tool_use", "id": "tu", "name": "read_document"}}),
        json!({"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": "{}"}}),
    ]);
    assert_eq!(
        events,
        vec![
            "R:",
            "R:Read it ",
            "R:first.",
            "R:",
            "S:tu:read_document",
            "A:tu:{}"
        ]
    );
    let StepResult::ToolCalls(calls) = parse_agent_response(&acc.into_content(), &|_| {}) else {
        panic!("expected tool calls");
    };
    let AgentTurn::ToolCall {
        reasoning: Some(Value::Array(blocks)),
        ..
    } = &calls[0]
    else {
        panic!("the first call carries the step's thinking");
    };
    assert_eq!(
        blocks[0],
        json!({"type": "thinking", "thinking": "Read it first.", "signature": "sig-1"})
    );
    assert_eq!(
        blocks[1],
        json!({"type": "redacted_thinking", "data": "enc"})
    );
}

/// Replay: the step's thinking blocks lead its assistant message, ahead
/// of the tool_use blocks, and only that step's.
#[test]
fn a_steps_thinking_blocks_lead_its_assistant_message() {
    let thought = json!({"type": "thinking", "thinking": "", "signature": "s"});
    let history = vec![
        user("q"),
        AgentTurn::ToolCall {
            call_id: "1".to_string(),
            name: "read_document".to_string(),
            arguments: "{}".to_string(),
            reasoning: Some(json!([thought.clone()])),
        },
        call("2", "b"),
        result("1", "x"),
        result("2", "y"),
        call("3", "c"),
        result("3", "z"),
    ];
    let messages = turns_to_messages(&history);
    let first = messages[1]["content"].as_array().unwrap();
    assert_eq!(first[0], thought);
    assert_eq!(first[1]["type"], "tool_use");
    assert_eq!(first[2]["type"], "tool_use");
    assert_eq!(messages[3]["content"][0]["type"], "tool_use");
    // The cache breakpoint still lands on a tool_use, never a thinking
    // block (which can't carry one).
    let request = body(&history);
    let blocks = request["messages"][1]["content"].as_array().unwrap();
    assert!(blocks[0].get("cache_control").is_none());
}

#[test]
fn tool_arguments_stream_as_they_are_written() {
    let tool = ToolSpec {
        name: "propose_edit".into(),
        description: "d".into(),
        parameters: json!({"type": "object"}),
    };
    let (request, _) = agent_request_body(
        &api_key(),
        "rules",
        &[user("q")],
        &[tool],
        true,
        &crate::capabilities::plan(
            "anthropic",
            "claude-sonnet-5-5",
            crate::capabilities::ThinkingLevel::Auto,
        ),
        "m",
    );
    let tools = request["tools"].as_array().unwrap();
    assert_eq!(tools[0]["eager_input_streaming"], true);
    // Not on the server's own web search.
    assert!(tools[1].get("eager_input_streaming").is_none());
}

#[test]
fn deep_thinking_request_shape() {
    let deep = crate::capabilities::plan(
        "anthropic",
        "claude-sonnet-5-5",
        crate::capabilities::ThinkingLevel::Deep,
    );
    let (request, beta) =
        agent_request_body(&api_key(), "rules", &[user("q")], &[], false, &deep, "m");
    assert!(!beta);
    assert_eq!(request["thinking"]["type"], "adaptive");
    assert_eq!(request["thinking"]["display"], "summarized");
    assert_eq!(request["output_config"]["effort"], "high");
    assert_eq!(request["max_tokens"], DEEP_MAX_TOKENS);
    // Auto: the request as it was, no thinking fields.
    let auto = body(&[user("q")]);
    assert!(auto.get("thinking").is_none());
    assert!(auto.get("output_config").is_none());
    assert_eq!(auto["max_tokens"], AGENT_MAX_TOKENS);
}

#[test]
fn a_single_call_caches_its_instructions_but_not_its_text() {
    for auth in [api_key(), AnthropicAuth::Oauth("t".to_string())] {
        let body = serde_json::to_value(completion_request(
            &auth,
            "rules".to_string(),
            "<text-before-cursor>The".to_string(),
            None,
        ))
        .unwrap();
        let system = body["system"].as_array().unwrap();
        let (last, before) = system.split_last().unwrap();
        assert_eq!(last["text"], "rules");
        assert_eq!(last["cache_control"]["type"], EPHEMERAL);
        // The OAuth identity block ahead of it carries no marker of its own.
        assert!(before.iter().all(|b| b.get("cache_control").is_none()));
        assert_eq!(body["messages"][0]["content"], "<text-before-cursor>The");
        assert!(body.get("cache_control").is_none());
    }
}

/// A cited reply comes as a text block per cited phrase: they join into
/// one sentence, each phrase marked with its page, and the text after a
/// search starts a paragraph of its own.
#[test]
fn cited_text_blocks_join_into_sentences_with_their_pages_marked() {
    let cite = |url: &str| json!([{"type": "web_search_result_location", "url": url, "title": "T", "cited_text": "…", "encrypted_index": "x"}]);
    let content = vec![
        json!({"type": "text", "text": "Let me look that up."}),
        json!({"type": "server_tool_use", "id": "s1", "name": "web_search", "input": {"query": "tides"}}),
        json!({"type": "web_search_tool_result", "tool_use_id": "s1", "content": []}),
        json!({"type": "text", "text": "Spring tides are "}),
        json!({"type": "text", "text": "highest at full moon", "citations": cite("https://a.example/")}),
        json!({"type": "text", "text": " and new moon", "citations": cite("https://b.example/")}),
        json!({"type": "text", "text": "."}),
    ];
    let cited = std::sync::Mutex::new(Vec::new());
    let sink = |e: ProviderEvent<'_>| {
        if let ProviderEvent::Citation { url, .. } = e {
            cited.lock().unwrap().push(url.to_string());
        }
    };
    let StepResult::Done(text) = parse_agent_response(&content, &sink) else {
        panic!("expected a final answer");
    };
    let shown = crate::agent::replace_citation_markers(&text, |k| Some(format!("[{k}]")));
    assert_eq!(
        shown,
        "Let me look that up.\n\nSpring tides are highest at full moon[1] and new moon[2]."
    );
    assert_eq!(
        cited.into_inner().unwrap(),
        ["https://a.example/", "https://b.example/"]
    );
}

/// What a paused turn is continued with: every block as the API sent
/// it - the search, its result, the text and its citations.
#[test]
fn the_stream_keeps_server_blocks_and_citations_for_a_paused_turn() {
    let (acc, _) = run_stream(&[
        json!({"type": "content_block_start", "index": 0, "content_block": {"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search", "input": {}}}),
        json!({"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": "{\"query\":\"tides\"}"}}),
        json!({"type": "content_block_start", "index": 1, "content_block": {"type": "web_search_tool_result", "tool_use_id": "srvtoolu_1", "content": [{"type": "web_search_result", "url": "https://a.example/", "title": "A", "encrypted_content": "e"}]}}),
        json!({"type": "content_block_start", "index": 2, "content_block": {"type": "text", "text": ""}}),
        json!({"type": "content_block_delta", "index": 2, "delta": {"type": "text_delta", "text": "Twice a day"}}),
        json!({"type": "content_block_delta", "index": 2, "delta": {"type": "citations_delta", "citation": {"type": "web_search_result_location", "url": "https://a.example/", "title": "A", "cited_text": "twice", "encrypted_index": "i"}}}),
        json!({"type": "message_delta", "delta": {"stop_reason": "pause_turn"}}),
    ]);
    assert_eq!(acc.stop_reason.as_deref(), Some("pause_turn"));
    let content = acc.into_content();
    assert_eq!(content[0]["type"], "server_tool_use");
    assert_eq!(content[0]["input"]["query"], "tides");
    assert_eq!(content[1]["content"][0]["encrypted_content"], "e");
    assert_eq!(content[2]["text"], "Twice a day");
    assert_eq!(content[2]["citations"][0]["url"], "https://a.example/");
}
