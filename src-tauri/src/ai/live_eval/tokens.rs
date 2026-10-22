//! Token accounting (docs/design/ai-tokens.md): what each kind of request
//! sends, part by part, and what a few real agent runs cost step by step.
//!
//! `live_token_breakdown` is free: it measures with Anthropic's count_tokens
//! endpoint, which counts a request without running it. `live_token_usage`
//! runs real conversations (about $0.30 on Sonnet 5.5) and prints each
//! step's input, cache write, cache read and output tokens.
//! `live_doubao_prefix_cache` sends one prompt to Volcengine Ark three times
//! to see whether its chat completions cache the prefix on their own.
//!
//! Run from src-tauri/:
//!   cargo test --lib live_eval::tokens -- --ignored --nocapture --test-threads=1

use super::agent_workspace::{put, scratch};
use super::checks::Caret;
use super::docs::{lang_doc, long_doc_zh, para};
use super::harness::{self, auth, block_on, secret, with_retry, AgentSetup, UserTurn};
use crate::ai::agent::{
    build_instructions, request_context, request_user_text, skill_index, AgentMode,
};
use crate::ai::client::{completion_prompt, grammar_instructions, grammar_user_text};
use crate::ai::tools;
use crate::ai::workspace::{self, AgentWorkspace};
use aicompat::agent::ToolSpec;
use aicompat::capabilities::ThinkingLevel;
use aicompat::providers::anthropic::AnthropicAuth;
use serde_json::{json, Value};

const COUNT_URL: &str = "https://api.anthropic.com/v1/messages/count_tokens";
const AGENT_MODEL: &str = "claude-sonnet-5-5";
const WRITING_MODEL: &str = "claude-haiku-5-5";

fn api_key(auth: &AnthropicAuth) -> &str {
    match auth {
        AnthropicAuth::ApiKey(key) => key,
        AnthropicAuth::Oauth(_) => panic!("count_tokens needs an API key"),
    }
}

fn tool_json(tool: &ToolSpec) -> Value {
    json!({"name": tool.name, "description": tool.description, "input_schema": tool.parameters})
}

/// Input tokens of a request with this system prompt, tools and user text.
fn count(key: &str, model: &str, system: Option<&str>, tools: &[Value], user: &str) -> u64 {
    let mut body = json!({
        "model": model,
        "messages": [{"role": "user", "content": user}],
    });
    if let Some(system) = system {
        body["system"] = json!(system);
    }
    if !tools.is_empty() {
        body["tools"] = json!(tools);
    }
    let value: Value = with_retry(|| {
        block_on(async {
            let res = reqwest::Client::new()
                .post(COUNT_URL)
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let status = res.status();
            let text = res.text().await.map_err(|e| e.to_string())?;
            if !status.is_success() {
                return Err(format!("count_tokens {status}: {text}"));
            }
            serde_json::from_str(&text).map_err(|e| e.to_string())
        })
    })
    .expect("count_tokens");
    value["input_tokens"].as_u64().expect("input_tokens")
}

/// Tokens `text` adds to a user message.
fn text_tokens(key: &str, model: &str, text: &str) -> u64 {
    count(key, model, None, &[], &format!("x\n{text}")) - count(key, model, None, &[], "x")
}

/// The built-in skills and no project folder: an unsaved draft, as the app
/// loads it (every built-in skill on).
fn draft_workspace() -> AgentWorkspace {
    workspace::load_layers(None, None, None, &[])
}

/// A saved document in a folder with a few notes: the project folder is the
/// document's own, with every file tool offered.
fn project_workspace(doc: &str) -> (AgentWorkspace, String) {
    let dir = scratch("tokens");
    let doc_path = put(&dir, "report.md", doc);
    put(
        &dir,
        "notes/interviews.md",
        "# Interview notes\n\nP3 said the Thursday slot clashed with school pickup. P7 asked for a reminder the day before. Two parents wanted shorter sessions.\n",
    );
    put(
        &dir,
        "notes/schedule.md",
        "# Schedule\n\nSessions run every second Thursday, 16:00-17:30, in the library's back room.\n",
    );
    put(&dir, "drafts/chapter-1.md", "# Chapter 1\n\nDraft.\n");
    let doc_path = doc_path.display().to_string();
    (workspace::load_from(None, Some(&doc_path), None), doc_path)
}

/// The system prompt cut at its section markers, so each part's share shows.
fn system_parts(system: &str) -> Vec<(&'static str, String)> {
    let markers = [
        ("role (AGENT_ROLE)", ""),
        ("interaction mode", "---interaction mode"),
        ("tool instructions", "\n\nUse search_document"),
        ("rules tools", "\n\ncheck_conventions checks"),
        ("project (workspace_section)", "\n\n---project---"),
        ("skill index", "\n\n---available skills---"),
    ];
    let mut cuts: Vec<(&'static str, usize)> = markers
        .iter()
        .filter_map(|(name, m)| {
            if m.is_empty() {
                Some((*name, 0))
            } else {
                system.find(m).map(|i| (*name, i))
            }
        })
        .collect();
    cuts.sort_by_key(|(_, i)| *i);
    cuts.iter()
        .enumerate()
        .map(|(n, (name, start))| {
            let end = cuts.get(n + 1).map_or(system.len(), |(_, i)| *i);
            (*name, system[*start..end].to_string())
        })
        .collect()
}

#[test]
#[ignore = "live API (free: count_tokens) - see module docs"]
fn live_token_breakdown() {
    let Some(auth) = auth() else { return };
    let key = api_key(&auth);
    let en = lang_doc(super::checks::Lang::En).doc;
    let draft = draft_workspace();
    let (project, _) = project_workspace(en);

    println!("\n## Agent system prompt and tools ({AGENT_MODEL})\n");
    println!("| setup | system | tools | system + tools |");
    println!("| --- | ---: | ---: | ---: |");
    for (label, ws, mode, ui) in [
        ("draft, Write, en", &draft, AgentMode::Write, "en"),
        ("draft, Review, en", &draft, AgentMode::Review, "en"),
        ("draft, Revise, en", &draft, AgentMode::Revise, "en"),
        ("draft, Revise, zh UI", &draft, AgentMode::Revise, "zh"),
        ("project, Revise, en", &project, AgentMode::Revise, "en"),
        (
            "project, Revise, remember on",
            &project,
            AgentMode::Revise,
            "en",
        ),
    ] {
        let system = build_instructions(ws, "", true, mode, "", ui);
        let specs =
            tools::ToolRegistry::builtin(ws.has_usable_skills(), ws.root.is_some(), mode, true)
                .specs();
        let tool_values: Vec<Value> = specs.iter().map(tool_json).collect();
        let bare = count(key, AGENT_MODEL, None, &[], "x");
        let with_system = count(key, AGENT_MODEL, Some(&system), &[], "x");
        let with_both = count(key, AGENT_MODEL, Some(&system), &tool_values, "x");
        println!(
            "| {label} | {} ({} chars) | {} ({} tools) | {} |",
            with_system - bare,
            system.chars().count(),
            with_both - with_system,
            specs.len(),
            with_both - bare
        );
    }

    println!("\n## System prompt by section (project, Revise, en)\n");
    let system = build_instructions(&project, "", true, AgentMode::Revise, "", "en");
    for (name, text) in system_parts(&system) {
        println!(
            "- {name}: {} tokens, {} chars",
            text_tokens(key, AGENT_MODEL, &text),
            text.chars().count()
        );
    }
    let index = skill_index(&project, "en");
    println!(
        "- (of which the skill list itself: {} tokens, {} skills)",
        text_tokens(key, AGENT_MODEL, &index),
        index.lines().count()
    );

    println!("\n## Each tool's marginal cost (project, Revise, images)\n");
    let specs = tools::ToolRegistry::builtin(true, true, AgentMode::Revise, true).specs();
    let all: Vec<Value> = specs.iter().map(tool_json).collect();
    let none = count(key, AGENT_MODEL, None, &[], "x");
    let with_all = count(key, AGENT_MODEL, None, &all, "x");
    let mut marginal_sum = 0;
    for (i, spec) in specs.iter().enumerate() {
        let rest: Vec<Value> = all
            .iter()
            .enumerate()
            .filter(|(j, _)| *j != i)
            .map(|(_, v)| v.clone())
            .collect();
        let marginal = with_all - count(key, AGENT_MODEL, None, &rest, "x");
        marginal_sum += marginal;
        println!(
            "- {}: {marginal} tokens ({} chars of description)",
            spec.name,
            spec.description.chars().count()
        );
    }
    println!(
        "- fixed tool-use overhead: {} tokens; all tools: {}",
        (with_all - none).saturating_sub(marginal_sum),
        with_all - none
    );
    let write_specs = tools::ToolRegistry::builtin(true, true, AgentMode::Write, true).specs();
    let insertion = write_specs
        .iter()
        .find(|s| s.name == "propose_edit")
        .expect("write mode has propose_edit");
    println!(
        "- propose_edit as Write mode offers it: {} tokens alone",
        count(key, AGENT_MODEL, None, &[tool_json(insertion)], "x")
            - count(key, AGENT_MODEL, None, &[], "x")
    );

    println!("\n## The current message: document context\n");
    let zh_long = long_doc_zh();
    let en_long = super::long_doc();
    let en_40k: String = en_long.chars().take(39_000).collect();
    for (label, doc) in [
        ("lang-en (short)", en.to_string()),
        ("en 39k chars (embedded whole)", en_40k),
        ("en 60k chars (outline + excerpts)", en_long),
        ("zh long (outline + excerpts)", zh_long.clone()),
        (
            "zh 20k chars (embedded whole)",
            zh_long.chars().take(20_000).collect(),
        ),
    ] {
        let context = request_context(&draft, &doc, true, "", None);
        let user = request_user_text(&context, "Tighten the second paragraph.");
        println!(
            "- {label}: document {} chars -> message {} tokens ({} chars)",
            doc.chars().count(),
            count(key, AGENT_MODEL, None, &[], &user),
            user.chars().count()
        );
    }

    println!("\n## Completion and grammar ({WRITING_MODEL})\n");
    let before = format!(
        "{}\n\nThe second session went better than the first, because",
        para(en, 0)
    );
    let hints = crate::ai::client::CompletionHints {
        title: Some("Reading club".into()),
        section: vec!["Reading club".into(), "Findings".into()],
        block: Some("paragraph".into()),
        prose: Some(before.clone()),
        ui_language: Some("en".into()),
        ..Default::default()
    };
    let (instructions, user) = completion_prompt(&before, "", &hints, None);
    let total = count(key, WRITING_MODEL, Some(&instructions), &[], &user);
    let user_only = count(key, WRITING_MODEL, None, &[], &user);
    println!(
        "- completion: {total} tokens = system {} + user {user_only} ({} chars of text before the cursor)",
        total - user_only,
        before.chars().count()
    );
    let paragraph = para(en, 1);
    let grammar = grammar_instructions(Some("standard"), Some("en"));
    let user = grammar_user_text(paragraph);
    let total = count(key, WRITING_MODEL, Some(&grammar), &[], &user);
    let user_only = count(key, WRITING_MODEL, None, &[], &user);
    println!(
        "- grammar: {total} tokens = system {} + paragraph {user_only}",
        total - user_only
    );
}

/// One conversation's per-step usage, printed as table rows.
fn report(label: &str, conv: &harness::Conversation) -> harness::Usage {
    let mut total = harness::Usage::default();
    for (t, outcome) in conv.outcomes.iter().enumerate() {
        let calls: Vec<String> = outcome
            .calls
            .iter()
            .map(|c| {
                format!(
                    "{} ({} chars)",
                    c["name"].as_str().unwrap_or("?"),
                    c["result"].as_str().map_or(0, |r| r.chars().count())
                )
            })
            .collect();
        for (s, u) in outcome.usage.iter().enumerate() {
            total.add(&conv.model, u);
            println!(
                "| {label} | {}.{} | {} | {} | {} | {} | {} |",
                t + 1,
                s + 1,
                u.input_tokens,
                u.cache_creation_input_tokens,
                u.cache_read_input_tokens,
                u.output_tokens,
                if s == 0 {
                    calls.join(", ")
                } else {
                    String::new()
                }
            );
        }
    }
    if let Some(e) = &conv.error {
        println!("| {label} | error: {e} | | | | | |");
    }
    total
}

#[test]
#[ignore = "live API (about $0.30) - see module docs"]
fn live_token_usage() {
    let Some(auth) = auth() else { return };
    let en = lang_doc(super::checks::Lang::En);
    let draft = draft_workspace();
    let (project, _) = project_workspace(en.doc);
    let run = |mode, ws: &AgentWorkspace, thinking, doc: &str, script: &[UserTurn]| {
        let setup = AgentSetup {
            model: AGENT_MODEL,
            mode,
            workspace: ws,
            focus_heading: None,
            ui_language: "en",
            thinking,
            pictures: None,
            memory: None,
        };
        harness::run_conversation(&auth, &setup, doc, script)
    };
    let selection = {
        let p = para(en.doc, 1);
        let start = en.doc.find(p).expect("paragraph in doc");
        (start, start + p.len())
    };
    let quick = |message: &str| UserTurn {
        caret: Caret {
            cursor: None,
            selection: Some(selection),
        },
        follow_selection: true,
        ..UserTurn::new(message)
    };

    println!("\n| run | message.step | input | cache write | cache read | output | tool calls (result size) |");
    println!("| --- | --- | ---: | ---: | ---: | ---: | --- |");
    let mut total = harness::Usage::default();
    let runs = [
        (
            "Revise, short doc",
            run(
                AgentMode::Revise,
                &draft,
                ThinkingLevel::Auto,
                en.doc,
                &[UserTurn::new(en.shorten), UserTurn::new("Now make it more formal.")],
            ),
        ),
        (
            "Review, question",
            run(
                AgentMode::Review,
                &draft,
                ThinkingLevel::Auto,
                en.doc,
                &[UserTurn::new(en.question)],
            ),
        ),
        (
            "Write, continue",
            run(
                AgentMode::Write,
                &draft,
                ThinkingLevel::Auto,
                en.doc,
                &[UserTurn::new("Add one closing paragraph about next year's plans, using only what the document says.")],
            ),
        ),
        (
            "Quick Ask (Fast)",
            run(
                AgentMode::Revise,
                &draft,
                ThinkingLevel::Fast,
                en.doc,
                &[quick("Make this shorter."), quick("Now more formal.")],
            ),
        ),
        (
            "Revise, 60k doc",
            run(
                AgentMode::Revise,
                &draft,
                ThinkingLevel::Auto,
                &super::long_doc(),
                &[UserTurn::new(
                    "Tighten the first paragraph of the 'Coding' section: same facts, fewer words.",
                )],
            ),
        ),
        (
            "Write, project folder",
            run(
                AgentMode::Write,
                &project,
                ThinkingLevel::Auto,
                en.doc,
                &[UserTurn::new("Using my interview notes in the project folder, add a short paragraph at the end about what participants said about the schedule.")],
            ),
        ),
    ];
    for (label, conv) in &runs {
        total.merge(&report(label, conv));
    }
    println!(
        "\nTotal: {} requests, {} input, {} cache write, {} cache read, {} output - ${:.4}",
        total.requests,
        total.input,
        total.cache_write,
        total.cache_read,
        total.output,
        total.cost_usd
    );

    // Completion and grammar: the same prompt twice, as typing pauses send it.
    let before = format!(
        "{}\n\nThe second session went better than the first, because",
        para(en.doc, 0)
    );
    let hints = crate::ai::client::CompletionHints {
        block: Some("paragraph".into()),
        prose: Some(before.clone()),
        ui_language: Some("en".into()),
        ..Default::default()
    };
    let (instructions, user) = completion_prompt(&before, "", &hints, None);
    for n in 1..=2 {
        let reply = harness::complete(&auth, &instructions, &user, None).expect("completion");
        let u = reply.usage;
        println!(
            "completion {n}: input {}, cache write {}, cache read {}, output {}",
            u.input_tokens,
            u.cache_creation_input_tokens,
            u.cache_read_input_tokens,
            u.output_tokens
        );
    }
    let grammar = grammar_instructions(Some("standard"), Some("en"));
    for (n, p) in [para(en.doc, 1), para(en.doc, 2)].iter().enumerate() {
        let reply =
            harness::complete(&auth, &grammar, &grammar_user_text(p), None).expect("grammar");
        let u = reply.usage;
        println!(
            "grammar {}: input {}, cache write {}, cache read {}, output {}",
            n + 1,
            u.input_tokens,
            u.cache_creation_input_tokens,
            u.cache_read_input_tokens,
            u.output_tokens
        );
    }
}

/// Whether Ark caches a repeated prefix by itself: the agent's system
/// prompt, tools and a message, sent three times (the third with another
/// message), printing each response's usage.
#[test]
#[ignore = "live API (Volcengine Ark) - see module docs"]
fn live_doubao_prefix_cache() {
    let Some(key) = secret("VOLCENGINE_ARK_API_KEY") else {
        eprintln!("live_eval: no VOLCENGINE_ARK_API_KEY - skipping");
        return;
    };
    let entry = crate::ai::catalog::find("doubao").expect("doubao");
    let base = entry.base_url.expect("base url");
    let model = entry.agent_default_model.expect("agent model");
    let en = lang_doc(super::checks::Lang::En);
    let ws = draft_workspace();
    let system = build_instructions(&ws, "", true, AgentMode::Review, "", "en");
    let tool_values: Vec<Value> = tools::ToolRegistry::builtin(
        true,
        false,
        AgentMode::Review,
        true,
    ).specs()
    .iter()
    .map(|t| json!({"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}}))
    .collect();
    let context = request_context(&ws, en.doc, true, "", None);
    let messages = [en.question, en.question, "Who is the document written for?"];
    // Chat Completions as the app sends them, then the Responses API with
    // Ark's own `caching` switch, which the app doesn't use.
    let requests = messages
        .iter()
        .map(|message| {
            (
                "chat/completions",
                json!({
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": request_user_text(&context, message)},
                    ],
                    "tools": tool_values,
                    "max_tokens": 200,
                    "reasoning_effort": "minimal",
                }),
            )
        })
        .chain(messages.iter().map(|message| {
            (
                "responses",
                json!({
                    "model": model,
                    "input": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": request_user_text(&context, message)},
                    ],
                    "max_output_tokens": 200,
                    "thinking": {"type": "disabled"},
                    "caching": {"type": "enabled"},
                }),
            )
        }));
    for (n, (path, body)) in requests.enumerate() {
        // The Responses API's cache is refused (403) on an account that
        // hasn't turned the cache service on in the Ark console: printed,
        // not failed.
        let usage = with_retry(|| {
            block_on(async {
                let res = reqwest::Client::new()
                    .post(format!("{base}/{path}"))
                    .bearer_auth(&key)
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                let status = res.status();
                let text = res.text().await.map_err(|e| e.to_string())?;
                if !status.is_success() {
                    return Err(format!("ark {status}: {text}"));
                }
                let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                Ok(v["usage"].clone())
            })
        });
        match usage {
            Ok(usage) => println!("[doubao] {path} request {}: {usage}", n % 3 + 1),
            Err(e) => println!("[doubao] {path} request {}: {e}", n % 3 + 1),
        }
        std::thread::sleep(std::time::Duration::from_secs(2));
    }
    // The same messages through the app's own step (AgentProvider), whose
    // usage now carries what Ark read from its cache, as Claude's does.
    let agent = aicompat::providers::AgentProvider {
        id: "doubao".into(),
        model: model.into(),
        endpoint: aicompat::providers::Endpoint::ChatCompletions {
            base_url: base.into(),
            api_key: Some(key.clone()),
            vendor: crate::ai::route::chat_vendor(base),
            stream_usage: true,
        },
        thinking: ThinkingLevel::Fast,
        native_search: None,
        enforce_binding: false,
    };
    let specs = tools::ToolRegistry::builtin(true, false, AgentMode::Review, true).specs();
    for (n, message) in messages.iter().enumerate() {
        let turn = aicompat::agent::AgentTurn::User {
            text: request_user_text(&context, message),
            images: Vec::new(),
        };
        let usage = with_retry(|| {
            block_on(agent.step(&system, std::slice::from_ref(&turn), &specs, &|_| {}))
        })
        .map(|(_, usage)| usage);
        println!("[doubao] app step {}: {usage:?}", n + 1);
        std::thread::sleep(std::time::Duration::from_secs(2));
    }
}
