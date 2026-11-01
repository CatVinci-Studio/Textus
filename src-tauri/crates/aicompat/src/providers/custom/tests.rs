use super::*;
use crate::agent::ImageAttachment;

/// The chat-completions image part, and that a text-only turn still sends a
/// plain string, which older compatible servers need.
#[test]
fn images_use_image_url_parts_and_text_only_turns_stay_strings() {
    let with_image = turns_to_messages(
        "be helpful",
        &[AgentTurn::User {
            text: "what is this?".to_string(),
            images: vec![ImageAttachment {
                name: "chart.png".to_string(),
                mime: "image/png".to_string(),
                data_base64: "AAAA".to_string(),
            }],
        }],
        false,
    );
    assert_eq!(with_image[1]["content"][0]["type"], "image_url");
    assert_eq!(
        with_image[1]["content"][0]["image_url"]["url"],
        "data:image/png;base64,AAAA"
    );
    assert_eq!(with_image[1]["content"][1]["text"], "what is this?");

    let text_only = turns_to_messages(
        "be helpful",
        &[AgentTurn::User {
            text: "hi".to_string(),
            images: Vec::new(),
        }],
        false,
    );
    assert_eq!(text_only[1]["content"], "hi");
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

#[test]
fn turns_to_messages_starts_with_system_and_groups_tool_turns() {
    // One step that called two tools, calls first.
    let history = vec![
        AgentTurn::User {
            text: "do it".to_string(),
            images: Vec::new(),
        },
        call("1", "a"),
        call("2", "b"),
        result("1", "found a"),
        result("2", "found b"),
        AgentTurn::assistant("done".to_string()),
    ];

    let messages = turns_to_messages("be helpful", &history, false);
    // system, user, assistant(tool_calls x2), tool, tool, assistant
    assert_eq!(messages.len(), 6);
    assert_eq!(messages[0]["role"], "system");
    assert_eq!(messages[0]["content"], "be helpful");
    assert_eq!(messages[1]["role"], "user");

    assert_eq!(messages[2]["role"], "assistant");
    let tool_calls = messages[2]["tool_calls"].as_array().unwrap();
    assert_eq!(tool_calls.len(), 2);
    assert_eq!(tool_calls[0]["id"], "1");
    assert_eq!(tool_calls[0]["function"]["name"], "search_document");
    assert_eq!(tool_calls[1]["id"], "2");

    assert_eq!(messages[3]["role"], "tool");
    assert_eq!(messages[3]["tool_call_id"], "1");
    assert_eq!(messages[3]["content"], "found a");
    assert_eq!(messages[4]["role"], "tool");
    assert_eq!(messages[4]["tool_call_id"], "2");

    assert_eq!(messages[5]["role"], "assistant");
    assert_eq!(messages[5]["content"], "done");
}

/// A `tool` message is text only, so a step's images come after its
/// tool messages, as one user message.
#[test]
fn tool_result_images_follow_the_tool_messages_as_a_user_message() {
    let history = vec![
        call("1", "a"),
        call("2", "b"),
        AgentTurn::ToolResult {
            call_id: "1".to_string(),
            output: "Here is map.png.".to_string(),
            images: vec![ImageAttachment {
                name: "map.png".to_string(),
                mime: "image/png".to_string(),
                data_base64: "AAAA".into(),
            }],
        },
        result("2", "found b"),
    ];
    let messages = turns_to_messages("rules", &history, false);
    // system, assistant(tool_calls), tool, tool, user(image)
    assert_eq!(messages.len(), 5);
    assert_eq!(messages[2]["content"], "Here is map.png.");
    assert_eq!(messages[3]["role"], "tool");
    assert_eq!(messages[4]["role"], "user");
    assert_eq!(messages[4]["content"][0]["type"], "image_url");
    assert_eq!(
        messages[4]["content"][0]["image_url"]["url"],
        "data:image/png;base64,AAAA"
    );
    assert_eq!(messages[4]["content"][1]["type"], "text");
}

/// Servers that cache prompt prefixes only help if a new step leaves the
/// messages before it alone: the next step's call starts its own message.
#[test]
fn a_new_step_only_appends_messages() {
    let mut turns = vec![AgentTurn::User {
        text: "doc + q".to_string(),
        images: Vec::new(),
    }];
    let mut before = turns_to_messages("rules", &turns, false);
    for step in [
        vec![call("r", "a"), result("r", "x")],
        vec![
            call("e1", "b"),
            call("e2", "c"),
            result("e1", "y"),
            result("e2", "z"),
        ],
    ] {
        turns.extend(step);
        let after = turns_to_messages("rules", &turns, false);
        assert_eq!(after[..before.len()], before[..]);
        before = after;
    }
    // system, user, then [assistant, tool] and [assistant, tool, tool].
    assert_eq!(before.len(), 7);
    assert_eq!(before[4]["tool_calls"].as_array().unwrap().len(), 2);
}

#[test]
fn parse_agent_response_prefers_tool_calls_over_content() {
    let message = json!({
        "role": "assistant",
        "content": null,
        "tool_calls": [{
            "id": "c1",
            "type": "function",
            "function": { "name": "propose_edit", "arguments": "{\"action\":\"append\"}" },
        }],
    });
    match parse_agent_response(&message, &SearchReport::default(), &|_| {}) {
        StepResult::ToolCalls(calls) => {
            assert_eq!(calls.len(), 1);
            let AgentTurn::ToolCall { call_id, name, .. } = &calls[0] else {
                panic!("expected a ToolCall turn");
            };
            assert_eq!(call_id, "c1");
            assert_eq!(name, "propose_edit");
        }
        StepResult::Done(_) => panic!("expected tool calls"),
    }
}

#[test]
fn parse_agent_response_falls_back_to_content() {
    let message = json!({ "role": "assistant", "content": "plain answer" });
    match parse_agent_response(&message, &SearchReport::default(), &|_| {}) {
        StepResult::Done(text) => assert_eq!(text, "plain answer"),
        StepResult::ToolCalls(_) => panic!("expected a final answer"),
    }
}

/// Feeds SSE data payloads through the accumulator, collecting the
/// events it reports as "T:text", "S:id:name", "A:id:delta" strings.
fn run_stream(chunks: &[&str]) -> (ChatStreamAccumulator, Vec<String>) {
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
    let mut acc = ChatStreamAccumulator::default();
    for chunk in chunks {
        acc.apply(chunk, &sink);
    }
    let reported = reported.into_inner().unwrap();
    (acc, reported)
}

#[test]
fn chat_stream_accumulates_text_deltas() {
    let (acc, events) = run_stream(&[
        r#"{"choices":[{"delta":{"role":"assistant"}}]}"#,
        r#"{"choices":[{"delta":{"content":"Hel"}}]}"#,
        r#"{"choices":[{"delta":{"content":"lo"}}]}"#,
        r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        "[DONE]",
    ]);
    assert_eq!(events, vec!["T:Hel", "T:lo"]);
    match acc.into_step_result(&|_| {}) {
        StepResult::Done(text) => assert_eq!(text, "Hello"),
        StepResult::ToolCalls(_) => panic!("expected a final answer"),
    }
}

#[test]
fn chat_stream_assembles_tool_calls_from_indexed_fragments() {
    let (acc, events) = run_stream(&[
        r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"propose_edit","arguments":""}}]}}]}"#,
        r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"action\":"}}]}}]}"#,
        r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"append\"}"}}]}}]}"#,
        r#"{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#,
        "[DONE]",
    ]);
    assert_eq!(
        events,
        vec!["S:c1:propose_edit", "A:c1:{\"action\":", "A:c1:\"append\"}",]
    );
    match acc.into_step_result(&|_| {}) {
        StepResult::ToolCalls(calls) => {
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
            assert_eq!(arguments, "{\"action\":\"append\"}");
        }
        StepResult::Done(_) => panic!("expected tool calls"),
    }
}

/// With `include_usage`, the usage comes in a last chunk with no
/// choices; what the server read from its prompt cache is in it.
#[test]
fn chat_stream_reads_the_usage_chunk() {
    let (acc, _) = run_stream(&[
        r#"{"choices":[{"delta":{"content":"Hi"}}],"usage":null}"#,
        r#"{"choices":[],"usage":{"prompt_tokens":6461,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":5944}}}"#,
        "[DONE]",
    ]);
    let usage = acc.usage.expect("the usage chunk was read");
    assert_eq!(
        (
            usage.input_tokens,
            usage.cache_read_input_tokens,
            usage.output_tokens
        ),
        (517, 5944, 2)
    );
}

#[test]
fn chat_stream_surfaces_mid_stream_errors() {
    let (acc, events) = run_stream(&[
        r#"{"choices":[{"delta":{"content":"par"}}]}"#,
        r#"{"error":{"message":"rate limited","code":429}}"#,
        r#"{"choices":[{"delta":{"content":"tial, ignored"}}]}"#,
    ]);
    assert_eq!(events, vec!["T:par"]);
    assert!(acc.error.as_deref().unwrap().contains("rate limited"));
}

/// DeepSeek-style thinking with tools: the reasoning streams as its own
/// events, never into the reply, and rides on the step's first call.
#[test]
fn chat_stream_keeps_reasoning_out_of_the_reply_and_on_the_call() {
    let (acc, events) = run_stream(&[
        r#"{"choices":[{"delta":{"reasoning_content":"Need the "}}]}"#,
        r#"{"choices":[{"delta":{"reasoning_content":"section."}}]}"#,
        r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"read_document","arguments":"{}"}}]}}]}"#,
        "[DONE]",
    ]);
    assert_eq!(
        events,
        vec!["R:Need the ", "R:section.", "S:c1:read_document", "A:c1:{}"]
    );
    let StepResult::ToolCalls(calls) = acc.into_step_result(&|_| {}) else {
        panic!("expected tool calls");
    };
    let AgentTurn::ToolCall { reasoning, .. } = &calls[0] else {
        panic!("expected a ToolCall turn");
    };
    assert_eq!(reasoning.as_ref().unwrap(), "Need the section.");

    // OpenRouter, Groq and Ollama name the field `reasoning`.
    let (acc, events) = run_stream(&[
        r#"{"choices":[{"delta":{"reasoning":"hm"}}]}"#,
        r#"{"choices":[{"delta":{"content":"Yes."}}]}"#,
    ]);
    assert_eq!(events, vec!["R:hm", "T:Yes."]);
    assert!(matches!(acc.into_step_result(&|_| {}), StepResult::Done(t) if t == "Yes."));
}

#[test]
fn a_steps_reasoning_goes_back_only_where_the_provider_wants_it() {
    let history = vec![
        AgentTurn::User {
            text: "q".to_string(),
            images: Vec::new(),
        },
        AgentTurn::ToolCall {
            call_id: "1".to_string(),
            name: "read_document".to_string(),
            arguments: "{}".to_string(),
            reasoning: Some(json!("Need the section.")),
        },
        result("1", "text"),
    ];
    let replayed = turns_to_messages("rules", &history, true);
    assert_eq!(replayed[2]["reasoning_content"], "Need the section.");
    assert_eq!(replayed[2]["tool_calls"][0]["id"], "1");
    let kept = turns_to_messages("rules", &history, false);
    assert!(kept[2].get("reasoning_content").is_none());

    // The non-streaming answer's reasoning lands on the call the same way.
    let StepResult::ToolCalls(calls) = parse_agent_response(
        &json!({
            "reasoning_content": "Look first.",
            "tool_calls": [{"id": "c", "function": {"name": "read_document", "arguments": "{}"}}],
        }),
        &SearchReport::default(),
        &|_| {},
    ) else {
        panic!("expected tool calls");
    };
    assert!(
        matches!(&calls[0], AgentTurn::ToolCall { reasoning: Some(r), .. } if r == "Look first.")
    );
}

#[test]
fn deepseek_deep_thinking_request_shape() {
    let deep = crate::capabilities::plan(
        "deepseek",
        "deepseek-v4-pro",
        crate::capabilities::ThinkingLevel::Deep,
    );
    let body = agent_request_body(
        "deepseek-v4-pro",
        "help",
        &[],
        &[],
        None,
        Vendor::Generic,
        &deep,
    );
    assert_eq!(body["thinking"]["type"], "enabled");
    assert_eq!(body["reasoning_effort"], "high");
    assert!(deep.replay);
}

/// The streamed chunks' text, with markers as [k], and the pages
/// reported.
fn cited_stream(chunks: &[&str]) -> (String, Vec<String>) {
    let pages = std::sync::Mutex::new(Vec::new());
    let sink = |e: ProviderEvent<'_>| {
        if let ProviderEvent::Citation { url, .. } = e {
            pages.lock().unwrap().push(url.to_string());
        }
    };
    let mut acc = ChatStreamAccumulator::default();
    for chunk in chunks {
        acc.apply(chunk, &sink);
    }
    let StepResult::Done(text) = acc.into_step_result(&sink) else {
        panic!("expected a final answer");
    };
    let text = crate::agent::replace_citation_markers(&text, |k| Some(format!("[{k}]")));
    (text, pages.into_inner().unwrap())
}

#[test]
fn openrouter_annotations_mark_their_links_once_however_often_streamed() {
    let annotation = r#"{"type":"url_citation","url_citation":{"url":"https://a.example/","title":"A","start_index":12,"end_index":43}}"#;
    let (text, pages) = cited_stream(&[
        r#"{"choices":[{"delta":{"content":"Tides turn ("}}]}"#,
        r#"{"choices":[{"delta":{"content":"[a.example](https://a.example/)) daily."}}]}"#,
        &format!(r#"{{"choices":[{{"delta":{{"annotations":[{annotation}]}}}}]}}"#),
        &format!(
            r#"{{"choices":[{{"delta":{{"annotations":[{annotation}]}},"finish_reason":"stop"}}]}}"#
        ),
    ]);
    assert_eq!(text, "Tides turn [1] daily.");
    assert_eq!(pages, ["https://a.example/"]);
}

#[test]
fn zhipu_refs_become_markers_by_their_results() {
    let (text, pages) = cited_stream(&[
        r#"{"web_search":[{"title":"潮汐","link":"https://z.example/1","refer":"ref_1"},{"title":"月相","link":"https://z.example/2","refer":"ref_2"}],"choices":[{"delta":{"content":"每天两次[ref_1]，"}}]}"#,
        r#"{"choices":[{"delta":{"content":"满月最高[来源：ref_2]。[note]"}}]}"#,
    ]);
    assert_eq!(text, "每天两次[1]，满月最高[2]。[note]");
    assert_eq!(pages, ["https://z.example/1", "https://z.example/2"]);
}

#[test]
fn groq_browser_marks_go_and_its_pages_are_reported() {
    let message = json!({
        "role": "assistant",
        "content": "Tides turn twice a day【2†L6-L10】.",
        "executed_tools": [{"type": "browser.search", "search_results": {"results": [{"title": "Tides", "url": "https://g.example/", "content": "…"}]}}],
    });
    let mut report = SearchReport::default();
    report.take(&message, &json!({}));
    let pages = std::sync::Mutex::new(Vec::new());
    let sink = |e: ProviderEvent<'_>| {
        if let ProviderEvent::Citation { url, .. } = e {
            pages.lock().unwrap().push(url.to_string());
        }
    };
    let StepResult::Done(text) = parse_agent_response(&message, &report, &sink) else {
        panic!("expected a final answer");
    };
    assert_eq!(text, "Tides turn twice a day.");
    assert_eq!(pages.into_inner().unwrap(), ["https://g.example/"]);
}

#[test]
fn agent_request_body_adds_each_native_search_shape() {
    let openrouter = agent_request_body(
        "openrouter/auto",
        "help",
        &[],
        &[],
        Some(NativeWebSearch::OpenRouter),
        Vendor::Generic,
        &Thinking::default(),
    );
    assert_eq!(openrouter["tools"][0]["type"], "openrouter:web_search");

    let groq = agent_request_body(
        "openai/gpt-oss-120b",
        "help",
        &[],
        &[],
        Some(NativeWebSearch::Groq),
        Vendor::Generic,
        &Thinking::default(),
    );
    assert_eq!(groq["tools"][0]["type"], "browser_search");

    let qwen = agent_request_body(
        "qwen-plus",
        "help",
        &[],
        &[],
        Some(NativeWebSearch::Qwen),
        Vendor::Generic,
        &Thinking::default(),
    );
    assert_eq!(qwen["enable_search"], true);

    let zhipu = agent_request_body(
        "glm-5.2",
        "help",
        &[],
        &[],
        Some(NativeWebSearch::Zhipu),
        Vendor::Generic,
        &Thinking::default(),
    );
    assert_eq!(zhipu["tools"][0]["type"], "web_search");
    assert_eq!(zhipu["tools"][0]["web_search"]["enable"], true);
}

#[test]
fn ark_agent_steps_lift_the_4096_token_answer_cap_and_keep_thinking() {
    let tools = [ToolSpec {
        name: "propose_edit".into(),
        description: "edit".into(),
        parameters: json!({"type": "object"}),
    }];
    let ark = agent_request_body(
        "doubao-seed-2-1-pro-260628",
        "help",
        &[],
        &tools,
        None,
        Vendor::Ark,
        &Thinking::default(),
    );
    assert_eq!(ark["max_tokens"], ARK_AGENT_MAX_TOKENS);
    assert_eq!(ark["tools"][0]["function"]["name"], "propose_edit");
    assert!(ark.get("reasoning_effort").is_none());
    assert!(ark.get("thinking").is_none());

    let generic = agent_request_body(
        "m",
        "help",
        &[],
        &tools,
        None,
        Vendor::Generic,
        &Thinking::default(),
    );
    assert!(generic.get("max_tokens").is_none());
}

#[test]
fn ark_writing_calls_turn_thinking_down_and_others_send_no_such_field() {
    let ark = serde_json::to_value(completion_request(
        "doubao-seed-2-1-turbo-260628",
        "rules".to_string(),
        "text".to_string(),
        Vendor::Ark,
    ))
    .unwrap();
    assert_eq!(ark["reasoning_effort"], "minimal");
    assert_eq!(ark["messages"][1]["content"], "text");

    let generic = serde_json::to_value(completion_request(
        "m",
        "rules".to_string(),
        "text".to_string(),
        Vendor::Generic,
    ))
    .unwrap();
    assert!(generic.get("reasoning_effort").is_none());
    assert!(generic.get("thinking").is_none());
}

#[test]
fn deepseek_writing_calls_switch_thinking_off() {
    let deepseek = serde_json::to_value(completion_request(
        "deepseek-flash",
        "rules".to_string(),
        "text".to_string(),
        Vendor::DeepSeek,
    ))
    .unwrap();
    assert_eq!(deepseek["thinking"], json!({"type": "disabled"}));
    assert!(deepseek.get("reasoning_effort").is_none());
}

/// Without it, MiniMax's thinking would land in the reply as `<think>`.
#[test]
fn minimax_keeps_its_thinking_out_of_the_answer() {
    let writing = serde_json::to_value(completion_request(
        "MiniMax-M3.1-Flash",
        "rules".to_string(),
        "text".to_string(),
        Vendor::MiniMax,
    ))
    .unwrap();
    assert_eq!(writing["reasoning_split"], true);
    assert_eq!(writing["reasoning_effort"], "low");
    let agent = agent_request_body(
        "MiniMax-M3",
        "help",
        &[],
        &[],
        None,
        Vendor::MiniMax,
        &Thinking::default(),
    );
    assert_eq!(agent["reasoning_split"], true);
    let generic = serde_json::to_value(completion_request(
        "m",
        "rules".to_string(),
        "text".to_string(),
        Vendor::Generic,
    ))
    .unwrap();
    assert!(generic.get("reasoning_split").is_none());
}

/// Ark (like DeepSeek) streams a thinking model's reasoning as
/// `reasoning_content` before the answer, then an `encrypted_content`
/// chunk with both empty - none of it is the reply.
#[test]
fn chat_stream_leaves_reasoning_out_of_the_reply() {
    let (acc, events) = run_stream(&[
        r#"{"choices":[{"delta":{"role":"assistant","content":"","reasoning_content":"The user wants"}}]}"#,
        r#"{"choices":[{"delta":{"content":"","reasoning_content":" a title."}}]}"#,
        r#"{"choices":[{"delta":{"content":"","reasoning_content":"","encrypted_content":"djF+abc"}}]}"#,
        r#"{"choices":[{"delta":{"content":"Field notes"}}]}"#,
        "[DONE]",
    ]);
    // The reasoning shows as thinking, never as reply text.
    assert_eq!(
        events,
        vec!["R:The user wants", "R: a title.", "T:Field notes"]
    );
    match acc.into_step_result(&|_| {}) {
        StepResult::Done(text) => assert_eq!(text, "Field notes"),
        StepResult::ToolCalls(_) => panic!("expected a final answer"),
    }
}

/// Gemini 3 sends a thought signature beside each call and refuses the next
/// request when a call comes back without it: it goes back on its call,
/// with the step's reasoning still where it was.
#[test]
fn a_calls_extra_content_goes_back_with_it() {
    let (acc, _) = run_stream(&[
        r#"{"choices":[{"delta":{"reasoning_content":"Load it."}}]}"#,
        r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"use_skill","arguments":"{}"},"extra_content":{"google":{"thought_signature":"sig-1"}}}]}}]}"#,
        r#"{"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","type":"function","function":{"name":"read_document","arguments":"{}"}}]}}]}"#,
        "[DONE]",
    ]);
    let StepResult::ToolCalls(calls) = acc.into_step_result(&|_| {}) else {
        panic!("expected tool calls");
    };
    let mut history = vec![AgentTurn::User {
        text: "q".to_string(),
        images: Vec::new(),
    }];
    history.extend(calls);
    history.push(result("c1", "skill"));
    history.push(result("c2", "text"));
    let sent = turns_to_messages("rules", &history, true);
    let assistant = &sent[2];
    assert_eq!(assistant["reasoning_content"], "Load it.");
    assert_eq!(
        assistant["tool_calls"][0]["extra_content"]["google"]["thought_signature"],
        "sig-1"
    );
    assert!(assistant["tool_calls"][1].get("extra_content").is_none());
    // Kept without the reasoning where the provider doesn't take it back.
    let kept = turns_to_messages("rules", &history, false);
    assert!(kept[2].get("reasoning_content").is_none());
    assert_eq!(
        kept[2]["tool_calls"][0]["extra_content"]["google"]["thought_signature"],
        "sig-1"
    );

    // The non-streaming answer keeps it the same way.
    let StepResult::ToolCalls(calls) = parse_agent_response(
        &json!({
            "tool_calls": [{"id": "c", "function": {"name": "read_document", "arguments": "{}"},
                "extra_content": {"google": {"thought_signature": "sig-2"}}}],
        }),
        &SearchReport::default(),
        &|_| {},
    ) else {
        panic!("expected tool calls");
    };
    let history = vec![calls[0].clone(), result("c", "text")];
    let sent = turns_to_messages("rules", &history, true);
    assert_eq!(
        sent[1]["tool_calls"][0]["extra_content"]["google"]["thought_signature"],
        "sig-2"
    );
}

#[test]
fn gemini_asks_for_its_thoughts_in_a_thinking_config() {
    use crate::capabilities::{plan, ThinkingLevel};
    let body = |model: &str, level| {
        agent_request_body(
            model,
            "help",
            &[],
            &[],
            None,
            Vendor::Generic,
            &plan("google", model, level),
        )
    };
    let config = |body: &Value| body["extra_body"]["google"]["thinking_config"].clone();
    // It refuses reasoning_effort beside a thinking_config: never both.
    let auto = body("gemini-3.5-flash", ThinkingLevel::Auto);
    assert_eq!(config(&auto), json!({"include_thoughts": true}));
    assert!(auto.get("reasoning_effort").is_none());
    let deep = body("gemini-3.5-flash", ThinkingLevel::Deep);
    assert_eq!(
        config(&deep),
        json!({"thinking_level": "high", "include_thoughts": true})
    );
    let fast = body("gemini-2.5-flash", ThinkingLevel::Fast);
    assert_eq!(config(&fast), json!({"thinking_budget": 0}));
}

#[test]
fn gemini_thoughts_in_the_text_stream_as_thinking() {
    let reported = std::sync::Mutex::new(Vec::new());
    let sink = |e: ProviderEvent<'_>| match e {
        ProviderEvent::Text(t) => reported.lock().unwrap().push(format!("T:{t}")),
        ProviderEvent::Thinking(t) => reported.lock().unwrap().push(format!("R:{t}")),
        _ => {}
    };
    let mut acc = ChatStreamAccumulator::default();
    // As Vertex AI streams them.
    for delta in [
        json!({"content": "**Weighing**\n\nBoth readings.", "extra_content": {"google": {"thought": true}}}),
        json!({"content": "The second."}),
        json!({"content": "", "extra_content": {"google": {"thought_signature": "s"}}}),
    ] {
        acc.apply(&json!({"choices": [{"delta": delta}]}).to_string(), &sink);
    }
    let step = acc.into_step_result(&sink);
    assert_eq!(
        reported.into_inner().unwrap(),
        ["R:**Weighing**\n\nBoth readings.", "T:The second."]
    );
    assert!(matches!(step, StepResult::Done(text) if text == "The second."));
}

#[test]
fn opencode_gets_a_steady_session_id_and_others_none() {
    let client = reqwest::Client::new();
    let request = |base: &str| {
        with_key(client.post(chat_completions_url(base)), base, "k")
            .build()
            .unwrap()
    };
    let first = request("https://opencode.ai/zen/go/v1");
    let again = request("https://opencode.ai/zen/go/v1");
    let session = first.headers().get("x-opencode-session").unwrap();
    assert!(session.to_str().unwrap().starts_with("textus-"));
    assert_eq!(Some(session), again.headers().get("x-opencode-session"));
    let other = request("https://api.deepseek.com/v1");
    assert!(other.headers().get("x-opencode-session").is_none());
}
