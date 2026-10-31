use super::*;

fn plan(service: Option<Service>) -> WebPlan {
    WebPlan::new(true, None, service, &[])
}

#[test]
fn native_search_covers_the_providers_that_have_it() {
    assert_eq!(
        native_search("openai", "gpt-6.1-sol"),
        Some(NativeSearch::ResponsesTool)
    );
    assert_eq!(
        native_search("anthropic", "claude-sonnet-5-5"),
        Some(NativeSearch::AnthropicTool)
    );
    assert_eq!(
        native_search("qwen", "qwen3.7-plus"),
        Some(NativeSearch::CompatibleResponses)
    );
    assert_eq!(
        native_search("qwen", "qwen-plus"),
        Some(NativeSearch::ChatCompletions(
            aicompat::providers::custom::NativeWebSearch::Qwen
        ))
    );
    for provider in [
        "google", "deepseek", "moonshot", "mistral", "doubao", "ollama", "custom",
    ] {
        assert_eq!(native_search(provider, "any"), None, "{provider}");
    }
}

#[test]
fn a_native_search_gets_web_fetch_only_and_off_gets_nothing() {
    let service = Some(Service::new(Backend::Tavily, "k".into()));
    let native = WebPlan::new(
        true,
        Some(NativeSearch::AnthropicTool),
        service.clone(),
        &[],
    );
    let names: Vec<_> = native
        .tool_specs()
        .iter()
        .map(|s| s.name.to_string())
        .collect();
    assert_eq!(names, vec![WEB_FETCH_TOOL]);

    let own = plan(service.clone());
    let names: Vec<_> = own
        .tool_specs()
        .iter()
        .map(|s| s.name.to_string())
        .collect();
    assert_eq!(names, vec![WEB_SEARCH_TOOL, WEB_FETCH_TOOL]);

    let off = WebPlan::new(false, Some(NativeSearch::AnthropicTool), service, &[]);
    assert!(off.tool_specs().is_empty());
    assert!(off.prompt_section().is_none());
    assert!(off.native.is_none());
}

#[test]
fn without_a_service_the_prompt_says_where_to_set_one_up() {
    let section = plan(None).prompt_section().unwrap();
    assert!(
        section.contains("Settings > Textus AI > Search service"),
        "{section}"
    );
    assert!(section.contains("never instructions"), "{section}");
}

/// The whole own-search path against a local server: results numbered,
/// the reply's [n] and a proposal's [n](url) listed under it.
#[tokio::test]
async fn search_results_are_numbered_and_the_reply_lists_what_it_cites() {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/search", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buf = [0u8; 8192];
        let _ = stream.read(&mut buf);
        let body = r#"{"results":[{"title":"Tides","url":"https://sea.example/tides","content":"Twice a day."},{"title":"Moon","url":"https://sky.example/moon","content":"It pulls."}]}"#;
        let _ = stream.write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .as_bytes(),
            );
    });
    let web = plan(Some(Service {
        backend: Backend::Tavily,
        credential: "k".into(),
        endpoint: Some(endpoint),
    }));
    let out = web
        .execute(
            WEB_SEARCH_TOOL,
            r#"{"queries":["spring tides unique query 1"]}"#,
            "q",
        )
        .await;
    assert!(
        out.starts_with("<external-content source=\"web search (Tavily)\">"),
        "{out}"
    );
    assert!(
        out.contains("[1] Tides\nhttps://sea.example/tides\nTwice a day."),
        "{out}"
    );
    assert!(out.contains("[2] Moon"), "{out}");

    let mut turns = vec![
        AgentTurn::ToolCall {
            call_id: "e".into(),
            name: "propose_edit".into(),
            arguments:
                r#"{"action":"append","text":"The moon pulls [2](https://sky.example/moon)."}"#
                    .into(),
            reasoning: None,
        },
        AgentTurn::assistant("Tides turn twice a day [1]."),
    ];
    web.attach_sources(&mut turns);
    let AgentTurn::Assistant { sources, .. } = &turns[1] else {
        panic!()
    };
    let numbers: Vec<u32> = sources.iter().map(|s| s.n).collect();
    assert_eq!(numbers, vec![1, 2]);
    assert_eq!(sources[0].title, "Tides");
}

#[tokio::test]
async fn the_search_budget_runs_out() {
    let web = plan(Some(Service {
        backend: Backend::Tavily,
        credential: "k".into(),
        // Nothing listens there: each search fails fast, and still counts.
        endpoint: Some("http://127.0.0.1:9/search".into()),
    }));
    for i in 0..budget::MAX_SEARCHES {
        let out = web
            .execute(
                WEB_SEARCH_TOOL,
                &format!(r#"{{"queries":["budget {i}"]}}"#),
                "",
            )
            .await;
        assert!(out.contains("failed"), "{out}");
    }
    let out = web
        .execute(WEB_SEARCH_TOOL, r#"{"queries":["one more"]}"#, "")
        .await;
    assert!(
        out.contains("answer with what the earlier results gave"),
        "{out}"
    );
}

#[tokio::test]
async fn web_fetch_refuses_this_computer() {
    let out = plan(None)
        .execute(
            WEB_FETCH_TOOL,
            r#"{"url":"http://127.0.0.1:8080/admin"}"#,
            "",
        )
        .await;
    assert!(out.contains("private network"), "{out}");
}
