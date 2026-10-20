//! Live web search (src/ai/web/): each search service whose key is set
//! (harness::secret - an environment variable or .env.local), web_fetch on
//! real pages, and Claude's own search with its citations numbered into a
//! reply's sources. `#[ignore]`, like the rest: it spends money and needs
//! the network.
//!
//!   cargo test --lib live_eval::web_search -- --ignored --nocapture

use super::harness::secret;
use crate::ai::web::search::{Backend, Service};
use crate::ai::web::{WebPlan, WEB_FETCH_TOOL};
use aicompat::agent::{run_agent_loop, AgentTurn, ProviderEvent};
use aicompat::capabilities::{self, NativeSearch, ThinkingLevel};
use aicompat::providers::anthropic;

/// Each service, and the .env.local name of its key (SearXNG: its address).
const SERVICES: &[(Backend, &str)] = &[
    (Backend::Deepseek, "DEEPSEEK_API_KEY"),
    (Backend::Zhipu, "ZHIPU_API_KEY"),
    (Backend::Kimi, "MOONSHOT_API_KEY"),
    (Backend::Bocha, "BOCHA_API_KEY"),
    (Backend::Tavily, "TAVILY_API_KEY"),
    (Backend::Brave, "BRAVE_API_KEY"),
    (Backend::Exa, "EXA_API_KEY"),
    (Backend::Searxng, "SEARXNG_URL"),
];

#[test]
#[ignore]
fn live_search_services_with_a_key_return_results() {
    let mut ran = Vec::new();
    for &(backend, name) in SERVICES {
        let Some(credential) = secret(name) else {
            continue;
        };
        let service = Service::new(backend, credential);
        let hits = tauri::async_runtime::block_on(service.search(
            "spring tide definition",
            5,
            "What is a spring tide?",
        ))
        .unwrap_or_else(|e| panic!("{}: {e}", backend.label()));
        assert!(!hits.is_empty(), "{}: no results", backend.label());
        assert!(hits.iter().all(|h| h.url.starts_with("http")));
        println!(
            "{}: {} results, first {}",
            backend.label(),
            hits.len(),
            hits[0].url
        );
        ran.push(backend.label());
    }
    println!("search services run: {ran:?} (the rest have no key set)");
}

#[test]
#[ignore]
fn live_web_fetch_reads_real_pages() {
    let web = WebPlan::new(true, None, None, &[]);
    for (url, expect) in [
        ("https://en.wikipedia.org/wiki/Tide", "tide"),
        ("https://zh.wikipedia.org/wiki/潮汐", "潮"),
        ("https://www.rust-lang.org/", "Rust"),
    ] {
        let out = tauri::async_runtime::block_on(web.execute(
            WEB_FETCH_TOOL,
            &serde_json::json!({ "url": url }).to_string(),
            "",
        ));
        assert!(out.starts_with("<external-content"), "{url}: {out}");
        assert!(out.contains(expect), "{url}: {out}");
        assert!(!out.contains("<script"), "{url}: {out}");
        println!(
            "{url}: {} chars\n{}\n…",
            out.chars().count(),
            out.chars().take(600).collect::<String>()
        );
    }
}

/// One exchange with Claude (the cheap model) under `web`, through the
/// app's loop and the web tools' bridge, with its sources attached. None
/// without a key.
fn ask_claude(web: &WebPlan, question: &str) -> Option<Vec<AgentTurn>> {
    let Some(key) = secret("ANTHROPIC_API_KEY") else {
        println!("ANTHROPIC_API_KEY not set - skipped");
        return None;
    };
    let auth = anthropic::AnthropicAuth::ApiKey(key);
    let instructions = format!(
        "You are a research assistant. Answer in two sentences.\n\n{}",
        web.prompt_section().unwrap()
    );
    let tools = web.tool_specs();
    let thinking = capabilities::plan(
        "anthropic",
        anthropic::COMPLETION_MODEL,
        ThinkingLevel::Auto,
    );
    let sink = |e: ProviderEvent<'_>| {
        if let ProviderEvent::Citation { url, title } = e {
            web.cite(url, title);
        }
    };
    let mut turns = tauri::async_runtime::block_on(run_agent_loop(
        vec![],
        AgentTurn::User {
            text: question.into(),
            images: Vec::new(),
        },
        4,
        |history| {
            let (instructions, tools, auth, sink, thinking) =
                (&instructions, &tools, &auth, &sink, &thinking);
            async move {
                anthropic::agent_step(
                    auth,
                    instructions,
                    &history,
                    tools,
                    web.native.is_some(),
                    thinking,
                    anthropic::COMPLETION_MODEL,
                    sink,
                )
                .await
                .map(|step| web.finish_step(step))
            }
        },
        // The bridge agent.rs's run_tool uses (TODO(agent-async)).
        |name, arguments| {
            tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current().block_on(web.execute(name, arguments, ""))
            })
        },
        |_| {},
    ))
    .unwrap();
    web.attach_sources(&mut turns);
    Some(turns)
}

fn reply(turns: &[AgentTurn]) -> (&str, &[aicompat::agent::Source]) {
    let Some(AgentTurn::Assistant { text, sources }) = turns.last() else {
        panic!("no reply: {turns:?}");
    };
    println!("{text}\n{sources:#?}");
    assert!(!text.contains('\u{E000}'), "a marker left in: {text}");
    (text, sources)
}

/// Claude searches by itself; its citations come back as [n] in the text
/// and as the reply's sources.
#[test]
#[ignore]
fn live_claude_native_search_cites_numbered_sources() {
    let web = WebPlan::new(true, Some(NativeSearch::AnthropicTool), None, &[]);
    let Some(turns) = ask_claude(
        &web,
        "What is the latest stable release of the Rust programming language, and when did it come out? Search the web.",
    ) else {
        return;
    };
    let (text, sources) = reply(&turns);
    assert!(!sources.is_empty(), "no sources: {text}");
    assert!(
        sources.iter().any(|s| text.contains(&format!("[{}]", s.n))),
        "no [n] in: {text}"
    );
}

/// No search at all, but a page the user names: web_fetch reads it, and
/// the reply cites it by the number the page got.
#[test]
#[ignore]
fn live_claude_reads_a_page_with_web_fetch_and_cites_it() {
    let web = WebPlan::new(true, None, None, &[]);
    let Some(turns) = ask_claude(
        &web,
        "Read https://www.rust-lang.org/ and tell me what it says Rust is for.",
    ) else {
        return;
    };
    assert!(
        turns
            .iter()
            .any(|t| matches!(t, AgentTurn::ToolCall { name, .. } if name == WEB_FETCH_TOOL)),
        "no web_fetch: {turns:?}"
    );
    let (text, sources) = reply(&turns);
    assert!(
        sources.iter().any(|s| s.url.contains("rust-lang.org")),
        "{sources:?}"
    );
    assert!(text.contains("[1]"), "not cited: {text}");
}
