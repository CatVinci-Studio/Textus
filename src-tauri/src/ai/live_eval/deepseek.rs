//! Live checks of the DeepSeek provider against api.deepseek.com itself:
//! thinking with tools through the app's own loop and tools (the
//! `reasoning_content` DeepSeek requires back on every step), Textus's own
//! web_search on DeepSeek's Search and Fetch APIs, the usage the app reads
//! (with what DeepSeek served from its prompt cache), the writing calls, and
//! the model list. Not a quality matrix: a few requests each, a few cents in
//! all.
//!
//! Needs DEEPSEEK_API_KEY, in the environment or .env.local (harness::secret);
//! without it each test prints a notice and passes. Run from src-tauri/:
//!   cargo test --lib live_eval::deepseek -- --ignored --nocapture

use super::harness::{block_on, secret, with_retry};
use crate::ai::agent::AgentMode;
use crate::ai::catalog;
use crate::ai::client::{self, CompletionHints};
use crate::ai::route::chat_vendor;
use crate::ai::rules::Conventions;
use crate::ai::tools::{ToolContext, ToolRegistry};
use crate::ai::web::search::{Backend, Service};
use crate::ai::web::{WebPlan, WEB_SEARCH_TOOL};
use aicompat::agent::{run_agent_loop, AgentTurn, ProviderEvent, StepUsage, ToolSpec};
use aicompat::capabilities::{self, ThinkingLevel};
use aicompat::providers::{custom, AgentProvider, Endpoint};
use std::sync::Mutex;

const KEY_VAR: &str = "DEEPSEEK_API_KEY";

struct DeepSeek {
    key: String,
    base_url: &'static str,
    writing_model: &'static str,
    agent_model: &'static str,
}

fn deepseek() -> Option<DeepSeek> {
    let Some(key) = secret(KEY_VAR) else {
        eprintln!("live_eval: no {KEY_VAR} - skipping DeepSeek");
        return None;
    };
    let entry = catalog::find("deepseek").expect("deepseek is in the catalog");
    Some(DeepSeek {
        key,
        base_url: entry.base_url.expect("deepseek has a base_url"),
        writing_model: entry.default_model.expect("deepseek has a writing default"),
        agent_model: entry
            .agent_default_model
            .expect("deepseek has an agent default"),
    })
}

/// Dollars per million tokens at the peak rate (input, cache hit, output),
/// from api-docs.deepseek.com/quick_start/pricing - off-peak is half.
fn price(model: &str) -> [f64; 3] {
    match model {
        "deepseek-flash" => [0.30, 0.006, 1.20],
        _ => [1.32, 0.044, 3.96],
    }
}

/// What a step cost, printed so a run shows its spend.
fn cost(model: &str, u: &StepUsage) -> f64 {
    let [i, r, o] = price(model);
    (u.input_tokens as f64 * i + u.cache_read_input_tokens as f64 * r + u.output_tokens as f64 * o)
        / 1_000_000.0
}

fn agent(ds: &DeepSeek, model: &str, thinking: ThinkingLevel) -> AgentProvider {
    AgentProvider {
        id: "deepseek".to_string(),
        model: model.to_string(),
        endpoint: Endpoint::ChatCompletions {
            base_url: ds.base_url.to_string(),
            api_key: Some(ds.key.clone()),
            vendor: chat_vendor(ds.base_url),
            stream_usage: capabilities::provider("deepseek").stream_usage,
        },
        thinking,
        native_search: None,
        enforce_binding: false,
    }
}

/// The tools' context for one exchange - its own, as each request's is:
/// the proposals it has made are kept there.
fn context<'a>(document: &'a str, conventions: &'a Conventions) -> ToolContext<'a> {
    ToolContext {
        undecided: &[],
        document,
        skills: &[],
        ui_language: "en",
        root: None,
        sees_images: false,
        conventions,
        library: &[],
        memory: None,
        proposed: Default::default(),
        checks: Default::default(),
    }
}

/// One exchange through the app's loop: the turns it added, the reasoning
/// that streamed, and what it cost.
struct Exchange {
    turns: Vec<AgentTurn>,
    thought: String,
    cost: f64,
}

fn exchange(
    agent: &AgentProvider,
    registry: &ToolRegistry,
    ctx: &ToolContext,
    instructions: &str,
    history: Vec<AgentTurn>,
    message: &str,
    web: Option<&WebPlan>,
) -> Exchange {
    let tools: Vec<ToolSpec> = registry.specs();
    let thought = Mutex::new(String::new());
    let spent = Mutex::new(0.0);
    let sink = |e: ProviderEvent<'_>| match e {
        ProviderEvent::Thinking(t) => thought.lock().unwrap().push_str(t),
        ProviderEvent::Citation { url, title } => {
            if let Some(web) = web {
                web.cite(url, title);
            }
        }
        _ => {}
    };
    let mut turns = block_on(run_agent_loop(
        history,
        AgentTurn::User {
            text: message.to_string(),
            images: Vec::new(),
        },
        8,
        |history| {
            let (tools, sink, spent) = (&tools, &sink, &spent);
            async move {
                let (step, usage) = agent.step(instructions, &history, tools, sink).await?;
                let usage = usage.expect("DeepSeek reports each step's usage");
                *spent.lock().unwrap() += cost(&agent.model, &usage);
                Ok(match web {
                    Some(web) => web.finish_step(step),
                    None => step,
                })
            }
        },
        |call| registry.execute(ctx, call),
        |name| registry.how_to_run(name),
        |_| {},
    ))
    .unwrap_or_else(|e| panic!("DeepSeek exchange failed: {e}"));
    if let Some(web) = web {
        web.attach_sources(&mut turns);
    }
    Exchange {
        turns,
        thought: thought.into_inner().unwrap(),
        cost: spent.into_inner().unwrap(),
    }
}

fn called(turns: &[AgentTurn]) -> Vec<&str> {
    turns
        .iter()
        .filter_map(|t| match t {
            AgentTurn::ToolCall { name, .. } => Some(name.as_str()),
            _ => None,
        })
        .collect()
}

fn reply(turns: &[AgentTurn]) -> &AgentTurn {
    turns
        .iter()
        .rev()
        .find(|t| matches!(t, AgentTurn::Assistant { .. }))
        .unwrap_or_else(|| panic!("no reply: {turns:?}"))
}

/// The history as the frontend keeps it between exchanges: a step's
/// reasoning dropped (agent.rs's for_history).
fn as_kept(turns: Vec<AgentTurn>) -> Vec<AgentTurn> {
    turns
        .into_iter()
        .map(|t| match t {
            AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
                ..
            } => AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
                reasoning: None,
            },
            t => t,
        })
        .collect()
}

const DOCUMENT: &str = "# Field report\n\n## Methods\n\nWe sampeled ten coastal sites in March.\n\n## Results\n\nEight sites had more birds than last year.";

/// Deep thinking on, off (the panel's default) and Fast, on the agent
/// model: read_document, then propose_edit, in one exchange - each step's
/// reasoning sent back with its calls, as DeepSeek requires with tools -
/// and a follow-up exchange on the history as the app keeps it.
#[test]
#[ignore = "live API - see module docs"]
fn live_deepseek_thinks_with_tools_across_steps_and_exchanges() {
    let Some(ds) = deepseek() else { return };
    let registry = ToolRegistry::builtin(false, false, AgentMode::Revise, false, false);
    let conventions = Conventions::default();
    let instructions = "You edit the user's Markdown document with the tools. The document isn't shown to you: read the part you need with read_document first, then propose changes with propose_edit, quoting the exact text. Reply in one sentence.";
    let mut total = 0.0;
    for level in [
        ThinkingLevel::Deep,
        ThinkingLevel::Auto,
        ThinkingLevel::Fast,
    ] {
        let agent = agent(&ds, ds.agent_model, level);
        let started = std::time::Instant::now();
        let first = exchange(
            &agent,
            &registry,
            &context(DOCUMENT, &conventions),
            instructions,
            Vec::new(),
            "Fix the spelling mistake in the Methods section.",
            None,
        );
        let names = called(&first.turns);
        eprintln!(
            "deepseek {level:?}: {names:?}, {} chars of thinking, {:?}, ${:.4}",
            first.thought.chars().count(),
            started.elapsed(),
            first.cost
        );
        assert!(names.contains(&"read_document"), "{level:?}: {names:?}");
        assert!(names.contains(&"propose_edit"), "{level:?}: {names:?}");
        let proposed = first.turns.iter().any(|t| {
            matches!(t, AgentTurn::ToolResult { output, .. } if output.starts_with("Edit proposed"))
        });
        assert!(
            proposed,
            "{level:?}: no edit went through: {:?}",
            first.turns
        );
        match level {
            ThinkingLevel::Fast => assert!(first.thought.is_empty(), "Fast still thought"),
            _ => assert!(!first.thought.is_empty(), "{level:?} streamed no reasoning"),
        }

        let second = exchange(
            &agent,
            &registry,
            &context(DOCUMENT, &conventions),
            instructions,
            as_kept(first.turns),
            "Thanks. Which section did you change? Answer without tools.",
            None,
        );
        eprintln!(
            "deepseek {level:?} follow-up: {:?}, ${:.4}",
            reply(&second.turns),
            second.cost
        );
        total += first.cost + second.cost;
    }
    eprintln!("deepseek thinking: ${total:.4} in all");
}

/// DeepSeek's Search and Fetch APIs as Settings' "Auto" service picks them
/// with a DeepSeek key, then a whole exchange searching through them with
/// the reply's sources numbered.
#[test]
#[ignore = "live API - see module docs"]
fn live_deepseek_search_service_and_numbered_sources() {
    let Some(ds) = deepseek() else { return };
    let service = Service::new(Backend::Deepseek, ds.key.clone());

    let hits = with_retry(|| {
        block_on(service.search("spring tide definition", 5, "What is a spring tide?"))
    })
    .unwrap_or_else(|e| panic!("search: {e}"));
    assert!(!hits.is_empty(), "no results");
    assert!(hits
        .iter()
        .all(|h| h.url.starts_with("http") && !h.title.is_empty()));
    assert!(hits.iter().any(|h| !h.snippet.is_empty()), "{hits:?}");
    eprintln!(
        "deepseek search: {} results, first {:?}",
        hits.len(),
        hits[0]
    );

    // DeepSeek takes 1-128 characters in each field and answers 400 to
    // anything else: a model's long query, and no question to rank by (a
    // message of only images).
    let long = "spring tide neap tide difference moon sun alignment ".repeat(4);
    let hits = block_on(service.search(&long, 3, "")).unwrap_or_else(|e| panic!("{e}"));
    assert!(!hits.is_empty(), "no results for the long query");

    let (title, page) = block_on(service.fetch_page("https://www.rust-lang.org/"))
        .expect("DeepSeek has a page reader")
        .unwrap_or_else(|e| panic!("fetch: {e}"));
    eprintln!(
        "deepseek fetch: {title:?}, {} chars: {:?}",
        page.chars().count(),
        page.chars().take(120).collect::<String>()
    );
    assert!(page.contains("Rust"), "{page}");
    // DeepSeek escapes every punctuation mark; the reader takes them out.
    assert!(!page.contains("\\."), "{page}");

    let question = "What is a spring tide? Search the web, and answer in two sentences.";
    let web = WebPlan::new(true, None, Some(service), &[]);
    let mut registry = ToolRegistry::new(AgentMode::Review);
    for tool in web.tools(question) {
        registry.add(tool);
    }
    let conventions = Conventions::default();
    let ctx = context("", &conventions);
    let instructions = format!(
        "You are a research assistant.\n\n{}",
        web.prompt_section().expect("web search is on")
    );
    let agent = agent(&ds, ds.writing_model, ThinkingLevel::Fast);
    let done = exchange(
        &agent,
        &registry,
        &ctx,
        &instructions,
        Vec::new(),
        question,
        Some(&web),
    );
    assert!(
        called(&done.turns).contains(&WEB_SEARCH_TOOL),
        "{:?}",
        done.turns
    );
    let AgentTurn::Assistant { text, sources } = reply(&done.turns) else {
        unreachable!()
    };
    eprintln!(
        "deepseek web answer (${:.4}): {text}\n{sources:#?}",
        done.cost
    );
    assert!(!sources.is_empty(), "no sources: {text}");
    assert!(
        sources.iter().any(|s| text.contains(&format!("[{}]", s.n))),
        "no [n] in: {text}"
    );
}

/// The usage the app reads from DeepSeek's stream, twice over the same
/// prefix: the second request's prompt comes from the cache
/// (`prompt_cache_hit_tokens`), and counts as cache read, not input.
#[test]
#[ignore = "live API - see module docs"]
fn live_deepseek_usage_reads_prompt_cache_hits() {
    let Some(ds) = deepseek() else { return };
    // Long enough to fill DeepSeek's 64-token cache units several times.
    let instructions = format!(
        "You are a concise assistant for a Markdown editor. {}",
        "Keep the writer's voice, and never invent facts. ".repeat(40)
    );
    let history = [AgentTurn::User {
        text: "Say hello in three words.".to_string(),
        images: Vec::new(),
    }];
    let plan = capabilities::plan("deepseek", ds.writing_model, ThinkingLevel::Fast);
    let step = || {
        with_retry(|| {
            block_on(custom::agent_step_streaming(
                ds.base_url,
                Some(&ds.key),
                ds.writing_model,
                &instructions,
                &history,
                &[],
                None,
                chat_vendor(ds.base_url),
                &plan,
                true,
                &|_| {},
            ))
        })
        .unwrap_or_else(|e| panic!("DeepSeek step failed: {e}"))
        .1
        .expect("DeepSeek reports usage (stream_options.include_usage)")
    };
    let first = step();
    // The cache is written as the first request finishes; give it a moment.
    std::thread::sleep(std::time::Duration::from_secs(2));
    let second = step();
    for (n, u) in [(1, &first), (2, &second)] {
        eprintln!(
            "deepseek usage {n}: input {}, cache read {}, output {}, ${:.5}",
            u.input_tokens,
            u.cache_read_input_tokens,
            u.output_tokens,
            cost(ds.writing_model, u)
        );
    }
    assert!(first.input_tokens + first.cache_read_input_tokens > 400);
    assert!(first.output_tokens > 0);
    assert!(
        second.cache_read_input_tokens > 0,
        "no cache hit on the second request: {second:?}"
    );
    assert_eq!(
        first.input_tokens + first.cache_read_input_tokens,
        second.input_tokens + second.cache_read_input_tokens,
        "the same prompt counts the same, however it was served"
    );
}

/// Inline completion and the grammar check, with the app's own prompts on
/// the writing model: answered without thinking, so quickly.
#[test]
#[ignore = "live API - see module docs"]
fn live_deepseek_writing_calls_answer_without_thinking() {
    let Some(ds) = deepseek() else { return };
    let call = |instructions: String, user_text: String| {
        let started = std::time::Instant::now();
        let reply = with_retry(|| {
            block_on(custom::call_completion(
                ds.base_url,
                Some(&ds.key),
                ds.writing_model,
                instructions.clone(),
                user_text.clone(),
                chat_vendor(ds.base_url),
            ))
        })
        .unwrap_or_else(|e| panic!("DeepSeek writing call failed: {e}"));
        (reply, started.elapsed())
    };

    let before = "The survey ran for three weeks. On the first morning we";
    let (instructions, user_text) =
        client::completion_prompt(before, "", &CompletionHints::default(), None);
    let (raw, took) = call(instructions, user_text);
    let shown = client::finish_completion(before, "", &raw, false);
    eprintln!("deepseek completion: {shown:?} in {took:?}");
    assert!(!shown.trim().is_empty(), "{raw:?}");
    assert!(!shown.contains("<think>"), "{raw:?}");

    let paragraph = "She go to school every days.";
    let (raw, took) = call(
        client::grammar_instructions(None, Some("en")),
        client::grammar_user_text(paragraph),
    );
    let issues =
        client::parse_grammar_reply(&raw, paragraph).unwrap_or_else(|e| panic!("{e}: {raw}"));
    eprintln!(
        "deepseek grammar: {} in {took:?}",
        serde_json::to_string(&issues).unwrap()
    );
    assert!(!issues.is_empty(), "{raw}");
}

/// Settings' model list for DeepSeek: GET /models, which also checks the key.
#[test]
#[ignore = "live API - see module docs"]
fn live_deepseek_lists_its_models() {
    let Some(ds) = deepseek() else { return };
    let models = with_retry(|| block_on(custom::list_models(ds.base_url, Some(&ds.key))))
        .unwrap_or_else(|e| panic!("listing failed: {e}"));
    eprintln!("deepseek models: {models:?}");
    let entry = catalog::find("deepseek").unwrap();
    for known in entry.known_models {
        assert!(
            models.iter().any(|m| m == known),
            "{known} not listed: {models:?}"
        );
    }
}
