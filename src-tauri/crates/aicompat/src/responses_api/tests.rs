use super::*;

#[test]
fn citation_markers_are_taken_out_of_text_and_arguments() {
    // Delimited, as the model writes them.
    assert_eq!(
        strip_citation_markers("返回选项及概率。\u{e200}cite\u{e202}turn3view0\u{e201}"),
        "返回选项及概率。"
    );
    // Their delimiters lost, as they reached a document (rc.5).
    assert_eq!(
        strip_citation_markers("中文输入应优先测试多语言版。citeturn2search0turn3view2\n\nNext"),
        "中文输入应优先测试多语言版。\n\nNext"
    );
    assert_eq!(
        strip_citation_markers("It was found citeturn1view0. Then"),
        "It was found. Then"
    );
    // Words that only start like one stay.
    assert_eq!(
        strip_citation_markers("We cite turnout data."),
        "We cite turnout data."
    );
    let call = parse_agent_output(
        &[
            json!({"type": "function_call", "call_id": "c1", "name": "propose_edit",
                "arguments": json!({"action": "append", "text": "Jev 的接口。citeturn3view0"}).to_string()}),
        ],
        &|_| {},
    );
    let StepResult::ToolCalls(calls) = call else {
        panic!("a call");
    };
    let AgentTurn::ToolCall { arguments, .. } = &calls[0] else {
        panic!("a call");
    };
    assert!(
        arguments.contains("Jev 的接口。") && !arguments.contains("cite"),
        "{arguments}"
    );
    // An anchor quotes the document as it is, markers and all.
    let call = parse_agent_output(
        &[
            json!({"type": "function_call", "call_id": "c2", "name": "propose_edit",
                "arguments": json!({"action": "replace", "anchor": "概率。citeturn3view0", "text": "概率。"}).to_string()}),
        ],
        &|_| {},
    );
    let StepResult::ToolCalls(calls) = call else {
        panic!("a call");
    };
    let AgentTurn::ToolCall { arguments, .. } = &calls[0] else {
        panic!("a call");
    };
    assert!(arguments.contains("概率。citeturn3view0"), "{arguments}");
}
use crate::agent::ImageAttachment;

#[test]
fn agent_request_body_round_trips_every_turn_kind() {
    let history = vec![
        AgentTurn::User {
            text: "hi".to_string(),
            images: Vec::new(),
        },
        AgentTurn::assistant("hello".to_string()),
        AgentTurn::ToolCall {
            call_id: "c1".to_string(),
            name: "search_document".to_string(),
            arguments: "{}".to_string(),
            reasoning: None,
        },
        AgentTurn::ToolResult {
            call_id: "c1".to_string(),
            output: "no matches".to_string(),
            images: Vec::new(),
        },
    ];
    let tools = [ToolSpec {
        name: "search_document".into(),
        description: "search".into(),
        parameters: json!({"type": "object"}),
    }];

    let body = agent_request_body(
        "gpt-5-mini",
        "be helpful",
        &history,
        &tools,
        false,
        &Thinking::default(),
        true,
    );

    assert_eq!(body["model"], "gpt-5-mini");
    assert_eq!(body["stream"], true);
    assert_eq!(body["input"].as_array().unwrap().len(), 4);
    assert_eq!(body["input"][2]["type"], "function_call");
    assert_eq!(body["input"][2]["call_id"], "c1");
    assert_eq!(body["input"][3]["type"], "function_call_output");
    assert_eq!(body["tools"].as_array().unwrap().len(), 1);
    assert_eq!(body["tools"][0]["name"], "search_document");
    // gpt-5* models get the verbosity hint, older ones don't.
    assert_eq!(body["text"]["verbosity"], "low");
}

/// OpenAI caches prompt prefixes on its own; every step and exchange
/// keeps it only if the earlier input items never change. One item per
/// turn, rendered from that turn alone, guarantees it.
#[test]
fn a_new_step_only_appends_input_items() {
    let mut turns = vec![AgentTurn::User {
        text: "doc + q".to_string(),
        images: Vec::new(),
    }];
    let before = agent_request_body(
        "gpt-6-luna",
        "rules",
        &turns,
        &[],
        false,
        &Thinking::default(),
        true,
    );
    turns.extend([
        AgentTurn::ToolCall {
            call_id: "c1".to_string(),
            name: "read_document".to_string(),
            arguments: "{}".to_string(),
            reasoning: None,
        },
        AgentTurn::ToolResult {
            call_id: "c1".to_string(),
            output: "text".to_string(),
            images: Vec::new(),
        },
    ]);
    let after = agent_request_body(
        "gpt-6-luna",
        "rules",
        &turns,
        &[],
        false,
        &Thinking::default(),
        true,
    );
    let (before, after) = (
        before["input"].as_array().unwrap(),
        after["input"].as_array().unwrap(),
    );
    assert_eq!(after[..before.len()], before[..]);
    assert_eq!(after.len(), before.len() + 2);
}

/// The image part's exact shape is the whole contract with the provider,
/// and getting it wrong fails at request time with an opaque 400 - worth
/// pinning here rather than discovering it from a user's bug report.
#[test]
fn user_turn_images_become_input_image_parts_before_the_text() {
    let turn = AgentTurn::User {
        text: "what is this?".to_string(),
        images: vec![ImageAttachment {
            name: "chart.png".to_string(),
            mime: "image/png".to_string(),
            data_base64: "AAAA".into(),
        }],
    };
    let item = turn_to_input_item(&turn);
    assert_eq!(item["content"][0]["type"], "input_image");
    assert_eq!(
        item["content"][0]["image_url"],
        "data:image/png;base64,AAAA"
    );
    // The question follows the picture it is about.
    assert_eq!(item["content"][1]["type"], "input_text");
    assert_eq!(item["content"][1]["text"], "what is this?");
}

/// A tool's images follow its output as a user message: the one place
/// the Codex backend and the Responses-compatible servers take them.
#[test]
fn tool_result_images_follow_the_output_as_a_user_message() {
    let history = vec![
        AgentTurn::ToolCall {
            call_id: "v".to_string(),
            name: "view_image".to_string(),
            arguments: "{}".to_string(),
            reasoning: None,
        },
        AgentTurn::ToolResult {
            call_id: "v".to_string(),
            output: "Here is map.png.".to_string(),
            images: vec![ImageAttachment {
                name: "map.png".to_string(),
                mime: "image/png".to_string(),
                data_base64: "AAAA".into(),
            }],
        },
    ];
    let body = agent_request_body(
        "gpt-5-mini",
        "rules",
        &history,
        &[],
        false,
        &Thinking::default(),
        true,
    );
    let input = body["input"].as_array().unwrap();
    assert_eq!(input.len(), 3);
    assert_eq!(input[1]["type"], "function_call_output");
    assert_eq!(input[1]["output"], "Here is map.png.");
    assert_eq!(input[2]["role"], "user");
    assert_eq!(input[2]["content"][0]["type"], "input_image");
    assert_eq!(
        input[2]["content"][0]["image_url"],
        "data:image/png;base64,AAAA"
    );
    assert!(input[2]["content"][1]["text"]
        .as_str()
        .unwrap()
        .contains("not sent by the user: map.png"));
}

#[test]
fn agent_request_body_appends_web_search_tool_and_skips_verbosity_on_old_models() {
    let body = agent_request_body(
        "gpt-4o-mini",
        "be helpful",
        &[],
        &[],
        true,
        &Thinking::default(),
        false,
    );
    assert_eq!(body["tools"].as_array().unwrap().len(), 1);
    assert_eq!(body["tools"][0]["type"], "web_search");
    assert!(body.get("text").is_none());
}

#[test]
fn agent_request_body_carries_the_thinking_plan() {
    let deep = crate::capabilities::plan(
        "openai",
        "gpt-6.1-sol",
        crate::capabilities::ThinkingLevel::Deep,
    );
    let body = agent_request_body("gpt-6.1-sol", "rules", &[], &[], false, &deep, true);
    assert_eq!(body["reasoning"]["effort"], "high");
    assert_eq!(body["reasoning"]["summary"], "auto");
    // Auto is the request as it always was.
    let auto = agent_request_body(
        "gpt-6.1-sol",
        "rules",
        &[],
        &[],
        false,
        &Thinking::default(),
        true,
    );
    assert!(auto.get("reasoning").is_none());
}

#[test]
fn quick_requests_ask_gpt6_for_its_lowest_reasoning_effort() {
    let luna =
        serde_json::to_value(ResponsesRequest::new("gpt-6-luna", "i".into(), "u".into())).unwrap();
    assert_eq!(luna["reasoning"]["effort"], "none");
    let sol =
        serde_json::to_value(ResponsesRequest::new("gpt-6.1-sol", "i".into(), "u".into())).unwrap();
    assert_eq!(sol["reasoning"]["effort"], "low");
    assert!(sol.get("text").is_none());
    let old =
        serde_json::to_value(ResponsesRequest::new("gpt-4o-mini", "i".into(), "u".into())).unwrap();
    assert!(old.get("reasoning").is_none());
}

#[test]
fn parse_agent_output_keeps_the_text_after_the_tool_calls() {
    let output = vec![
        json!({"type": "function_call", "call_id": "c1", "name": "propose_edit", "arguments": "{\"action\":\"append\"}"}),
        json!({"type": "message", "content": [{"text": "Added a line."}]}),
    ];
    match parse_agent_output(&output, &|_| {}) {
        StepResult::ToolCalls(calls) => {
            assert_eq!(calls.len(), 2);
            assert!(
                matches!(&calls[1], AgentTurn::Assistant { text, .. } if text == "Added a line.")
            );
            let AgentTurn::ToolCall { call_id, name, .. } = &calls[0] else {
                panic!("expected a ToolCall turn");
            };
            assert_eq!(call_id, "c1");
            assert_eq!(name, "propose_edit");
        }
        StepResult::Done(_) => panic!("expected tool calls"),
    }
}

/// Runs `output` through parse_agent_output and shows its markers as
/// [k], with the pages it reported.
fn cited(output: &[Value]) -> (String, Vec<(String, String)>) {
    let pages = std::sync::Mutex::new(Vec::new());
    let sink = |e: ProviderEvent<'_>| {
        if let ProviderEvent::Citation { url, title } = e {
            pages
                .lock()
                .unwrap()
                .push((url.to_string(), title.to_string()));
        }
    };
    let StepResult::Done(text) = parse_agent_output(output, &sink) else {
        panic!("expected a final answer");
    };
    let text = crate::agent::replace_citation_markers(&text, |k| Some(format!("[{k}]")));
    (text, pages.into_inner().unwrap())
}

#[test]
fn openai_inline_citation_links_become_numbered_markers() {
    let text = "Spring tides peak at full moon ([noaa.gov](https://noaa.gov/tides)). Neap tides are weakest ([例子](https://例.example/x)).";
    let span = |needle: &str| {
        let byte = text.find(needle).unwrap();
        let start = text[..byte].chars().count();
        (start, start + needle.chars().count())
    };
    let (a0, a1) = span("[noaa.gov](https://noaa.gov/tides)");
    let (b0, b1) = span("([例子](https://例.example/x))");
    let output = vec![json!({"type": "message", "content": [{
        "type": "output_text",
        "text": text,
        "annotations": [
            {"type": "url_citation", "url": "https://noaa.gov/tides", "title": "Tides", "start_index": a0, "end_index": a1},
            {"type": "url_citation", "url": "https://例.example/x", "title": "例子", "start_index": b0, "end_index": b1},
        ],
    }]})];
    let (text, pages) = cited(&output);
    assert_eq!(
        text,
        "Spring tides peak at full moon [1]. Neap tides are weakest [2]."
    );
    assert_eq!(pages[0], ("https://noaa.gov/tides".into(), "Tides".into()));
}

/// xAI writes "[[1]](url)" and puts the number, not the page's title,
/// in `title`; Qwen names its pages only in the web_search_call.
#[test]
fn xai_numbers_are_not_titles_and_qwen_sources_are_reported() {
    let text = "It rose 3% [[1]](https://x.example/a).";
    let start = text.find("[[").unwrap();
    let output = vec![
        json!({"type": "web_search_call", "action": {"type": "search", "sources": [{"url": "https://q.example/"}]}}),
        json!({"type": "message", "content": [{
            "type": "output_text",
            "text": text,
            "annotations": [{"type": "url_citation", "url": "https://x.example/a", "title": "1", "start_index": start, "end_index": text.len() - 1}],
        }]}),
    ];
    let (text, pages) = cited(&output);
    assert_eq!(text, "It rose 3% [2].");
    assert_eq!(
        pages,
        vec![
            ("https://q.example/".to_string(), String::new()),
            ("https://x.example/a".to_string(), String::new())
        ]
    );
}

#[test]
fn parse_agent_output_joins_message_text_when_no_tool_calls() {
    let output =
        vec![json!({"type": "message", "content": [{"text": "part one"}, {"text": "part two"}]})];
    match parse_agent_output(&output, &|_| {}) {
        StepResult::Done(text) => assert_eq!(text, "part one\npart two"),
        StepResult::ToolCalls(_) => panic!("expected a final answer"),
    }
}
