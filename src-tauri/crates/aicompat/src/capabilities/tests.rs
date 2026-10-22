use super::*;

fn efforts(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| v.to_string()).collect()
}

#[test]
fn the_generated_table_knows_the_pinned_models() {
    assert_eq!(
        model_reasoning("anthropic", "claude-haiku-5-5"),
        ModelReasoning::Options {
            toggle: true,
            efforts: efforts(&["low", "medium", "high", "xhigh", "max"]),
            budget: None,
        }
    );
    assert_eq!(
        model_reasoning("mistral", "mistral-large-latest"),
        ModelReasoning::No
    );
    assert_eq!(
        model_reasoning("custom", "my-model"),
        ModelReasoning::Unknown
    );
}

#[test]
fn deep_thinking_is_offered_only_where_it_changes_something() {
    assert!(can_think_deeper("anthropic", "claude-sonnet-5-5"));
    assert!(can_think_deeper("deepseek", "deepseek-v4-pro"));
    assert!(can_think_deeper("zhipu", "glm-4.7-flash"));
    assert!(can_think_deeper("ollama", "qwen3:8b"));
    assert!(!can_think_deeper("mistral", "mistral-large-latest"));
    assert!(!can_think_deeper("openai", "gpt-4o"));
}

#[test]
fn streamed_usage_is_asked_for_only_where_the_server_takes_it() {
    assert!(provider("deepseek").stream_usage && provider("doubao").stream_usage);
    assert!(!provider("mistral").stream_usage, "rejects unknown fields");
    assert!(!provider("custom").stream_usage && !provider("new-entry").stream_usage);
}

#[test]
fn auto_sends_nothing() {
    for (provider, model) in [
        ("openai", "gpt-6.1-sol"),
        ("anthropic", "claude-sonnet-5-5"),
        ("qwen", "qwen3.7-plus"),
    ] {
        assert!(!plan(provider, model, ThinkingLevel::Auto).sends_parameters());
    }
}

#[test]
fn auto_turns_deepseek_down_to_low() {
    let pro = plan("deepseek", "deepseek-v4-pro", ThinkingLevel::Auto);
    assert_eq!(pro.effort.as_deref(), Some("low"));
    assert_eq!(
        plan("deepseek", "deepseek-v4-pro", ThinkingLevel::Deep)
            .effort
            .as_deref(),
        Some("high")
    );
}

#[test]
fn auto_turns_ark_down_to_low_where_the_model_takes_it() {
    let seed = plan("doubao", "doubao-seed-2-1-pro-260628", ThinkingLevel::Auto);
    assert_eq!(seed.effort.as_deref(), Some("low"));
    // Deep still asks for more.
    assert_eq!(
        plan("doubao", "doubao-seed-2-1-pro-260628", ThinkingLevel::Deep)
            .effort
            .as_deref(),
        Some("high")
    );
    // A model the table doesn't know: the provider's default.
    assert!(!plan("doubao", "doubao-unknown", ThinkingLevel::Auto).sends_parameters());
}

#[test]
fn deep_asks_for_high_never_xhigh_or_max() {
    assert_eq!(
        plan("openai", "gpt-6.1-sol", ThinkingLevel::Deep).effort,
        Some("high".into())
    );
    assert_eq!(
        deep_effort(&efforts(&["low", "medium", "xhigh"])),
        Some("medium".into())
    );
    assert_eq!(
        deep_effort(&efforts(&["low", "high", "max"])),
        Some("high".into())
    );
}

#[test]
fn fast_turns_thinking_off_or_down_as_far_as_the_model_allows() {
    // Luna can be switched off; Sol bottoms out at low.
    let luna = plan("openai", "gpt-6-luna", ThinkingLevel::Fast);
    assert_eq!(luna.on, Some(false));
    let sol = plan("openai", "gpt-6.1-sol", ThinkingLevel::Fast);
    assert_eq!(sol.effort.as_deref(), Some("low"));
    // Haiku 5.5 switches off; Sonnet 5.5 can't, so low effort.
    assert_eq!(
        plan("anthropic", "claude-haiku-5-5", ThinkingLevel::Fast).on,
        Some(false)
    );
    assert_eq!(
        plan("anthropic", "claude-sonnet-5-5", ThinkingLevel::Fast)
            .effort
            .as_deref(),
        Some("low")
    );
    // A model the table doesn't know keeps its default.
    assert!(!plan("custom", "local", ThinkingLevel::Fast).sends_parameters());
}

fn chat_body(thinking: &Thinking) -> Value {
    let mut body = json!({"model": "m"});
    thinking.apply_chat_completions(&mut body);
    body
}

#[test]
fn each_chat_completions_format_has_its_own_fields() {
    let openai = chat_body(&plan("groq", "openai/gpt-oss-120b", ThinkingLevel::Deep));
    assert_eq!(openai["reasoning_effort"], "high");

    let deepseek = chat_body(&plan("deepseek", "deepseek-v4-pro", ThinkingLevel::Deep));
    assert_eq!(deepseek["thinking"]["type"], "enabled");
    assert_eq!(deepseek["reasoning_effort"], "high");
    let deepseek_fast = chat_body(&plan("deepseek", "deepseek-v4-pro", ThinkingLevel::Fast));
    assert_eq!(deepseek_fast["thinking"]["type"], "disabled");
    assert!(deepseek_fast.get("reasoning_effort").is_none());

    let qwen = chat_body(&plan("qwen", "qwen3.7-plus", ThinkingLevel::Deep));
    assert_eq!(qwen["enable_thinking"], true);
    assert_eq!(qwen["thinking_budget"], DEEP_BUDGET);
    let qwen_fast = chat_body(&plan("qwen", "qwen3.8-flash", ThinkingLevel::Fast));
    assert_eq!(qwen_fast["enable_thinking"], false);
    assert!(qwen_fast.get("thinking_budget").is_none());

    let glm = chat_body(&plan("zhipu", "glm-4.7-flash", ThinkingLevel::Deep));
    assert_eq!(glm["thinking"]["type"], "enabled");
    let kimi = chat_body(&plan("moonshot", "kimi-k3", ThinkingLevel::Deep));
    assert_eq!(kimi["reasoning_effort"], "high");

    let router = chat_body(&plan("openrouter", "openrouter/auto", ThinkingLevel::Deep));
    assert_eq!(router["reasoning"]["effort"], "high");

    let gemini = chat_body(&plan("google", "gemini-3.8-flash", ThinkingLevel::Fast));
    assert_eq!(gemini["reasoning_effort"], "low");

    let mistral = chat_body(&plan(
        "mistral",
        "mistral-large-latest",
        ThinkingLevel::Deep,
    ));
    assert_eq!(mistral, json!({"model": "m"}));
}

#[test]
fn responses_requests_ask_for_a_summary_when_deep() {
    let mut body = json!({});
    plan("openai", "gpt-6.1-sol", ThinkingLevel::Deep).apply_responses(&mut body);
    assert_eq!(
        body["reasoning"],
        json!({"effort": "high", "summary": "auto"})
    );
    let mut fast = json!({});
    plan("openai", "gpt-6-luna", ThinkingLevel::Fast).apply_responses(&mut fast);
    assert_eq!(fast["reasoning"], json!({"effort": "none"}));
}

#[test]
fn claude_gets_adaptive_thinking_and_an_effort() {
    let mut deep = json!({"max_tokens": 16384});
    let beta =
        plan("anthropic", "claude-sonnet-5-5", ThinkingLevel::Deep).apply_anthropic(&mut deep);
    assert!(!beta);
    assert_eq!(
        deep["thinking"],
        json!({"type": "adaptive", "display": "summarized"})
    );
    assert_eq!(deep["output_config"]["effort"], "high");

    let mut fast = json!({"max_tokens": 16384});
    plan("anthropic", "claude-haiku-5-5", ThinkingLevel::Fast).apply_anthropic(&mut fast);
    assert_eq!(fast["thinking"], json!({"type": "disabled"}));
    assert!(fast.get("output_config").is_none());

    // A budget model: max_tokens grows by the budget it must exceed.
    let old = Thinking {
        format: Some(ThinkingFormat::Anthropic),
        budget: Some(DEEP_BUDGET),
        show: true,
        ..Thinking::default()
    };
    let mut body = json!({"max_tokens": 16384});
    old.apply_anthropic(&mut body);
    assert_eq!(body["thinking"]["budget_tokens"], DEEP_BUDGET);
    assert_eq!(body["max_tokens"], 16384 + DEEP_BUDGET);

    let mut auto = json!({"max_tokens": 16384});
    plan("anthropic", "claude-sonnet-5-5", ThinkingLevel::Auto).apply_anthropic(&mut auto);
    assert_eq!(auto, json!({"max_tokens": 16384}));
}

#[test]
fn a_refused_parameter_is_retried_without_and_not_sent_again() {
    let thinking = plan("custom", "refuses-effort", ThinkingLevel::Deep);
    assert!(thinking.sends_parameters());
    let sent = std::cell::RefCell::new(Vec::new());
    let result = tauri::async_runtime::block_on(with_fallback(
        "custom",
        "refuses-effort",
        &thinking,
        |t| {
            sent.borrow_mut().push(t.sends_parameters());
            async move {
                if t.sends_parameters() {
                    Err("Custom endpoint request failed (400 Bad Request): {\"error\":\"Unrecognized request argument supplied: reasoning_effort\"}".to_string())
                } else {
                    Ok("answer")
                }
            }
        },
    ));
    assert_eq!(result.unwrap(), "answer");
    assert_eq!(*sent.borrow(), [true, false]);
    assert!(!plan("custom", "refuses-effort", ThinkingLevel::Deep).sends_parameters());
}

#[test]
fn qwen_search_endpoint_tracks_model_generation() {
    for model in ["qwen3.7-plus", "qwen3.5-flash", "qwen3-max"] {
        assert_eq!(
            search_route("qwen", model),
            NativeSearch::CompatibleResponses
        );
    }
    for model in ["qwen-plus", "qwen-flash"] {
        assert_eq!(
            search_route("qwen", model),
            NativeSearch::ChatCompletions(NativeWebSearch::Qwen)
        );
    }
    assert_eq!(
        search_route("xai", "grok-4.7"),
        NativeSearch::CompatibleResponses
    );
    assert_eq!(
        search_route("deepseek", "deepseek-v4-pro"),
        NativeSearch::None
    );
}

#[test]
fn other_errors_are_not_mistaken_for_a_refusal() {
    assert!(!is_thinking_refusal(
        "Claude request failed (429 Too Many Requests): rate limited"
    ));
    assert!(!is_thinking_refusal(
        "Claude request failed (400 Bad Request): prompt is too long"
    ));
    assert!(is_thinking_refusal(
        "Claude request failed (400 Bad Request): thinking.type: disabled is not supported"
    ));
}
