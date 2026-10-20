//! Live evaluation against the real Anthropic API: a matrix of writing tasks
//! run through the app's own prompts, tools and agent loop, each checked
//! automatically and graded by an LLM judge, so a prompt or model change can
//! be compared run to run instead of by feel. Every live test here is
//! `#[ignore]` - it spends money and needs a key, so CI never runs it (the
//! checking code itself is unit-tested in checks.rs and does run in CI).
//!
//! Run from src-tauri/ (docs/design/ai-eval.md has the full guide and results):
//!   cargo test --lib live_eval -- --ignored --nocapture --test-threads=1
//! The built-in skills suite alone, automatic checks only:
//!   TEXTUS_EVAL_JUDGE=0 cargo test --lib live_eval::live_agent_builtin -- --ignored --nocapture
//!
//! Knobs, all optional:
//!   ANTHROPIC_API_KEY          the key; like every key a live run uses, read
//!                             from the environment or from `.env.local` at the
//!                             repository root (git-ignored), or the file
//!                             TEXTUS_ENV_FILE names (harness::secret)
//!   TEXTUS_ANTHROPIC_KEY_FILE  the older one-key file (default:
//!                             .anthropic-api-key.local at the repository root)
//!   TEXTUS_EVAL_FILTER         only cases whose id contains one of these
//!                             comma-separated substrings
//!   TEXTUS_EVAL_AGENT_MODEL    run the agent matrix on another model
//!   TEXTUS_EVAL_WRITING_MODEL  run completion/grammar on another model
//!   TEXTUS_EVAL_JUDGE=0        skip the judge (automatic checks only)
//!   TEXTUS_EVAL_JOBS           concurrent cases (default 6)
//!   TEXTUS_EVAL_OUT            where the per-suite .jsonl/.md results go
//!                             (default: a fresh folder under the temp dir)
//!   TEXTUS_EVAL_BUDGET_USD     stop starting cases once the run has spent this
//!   TEXTUS_EVAL_SPEND_FILE     a {"spent_usd", "runs"} ledger each suite adds to
//!
//! Without a key, every test prints a notice and passes vacuously.
//!
//! doubao.rs is the one suite on another provider: a few request-shape
//! checks against Volcengine Ark, keyed by VOLCENGINE_ARK_API_KEY.

mod agent_builtin;
mod agent_everyday;
mod agent_matrix;
mod agent_workspace;
mod checks;
mod checks_builtin;
mod completion_cases;
mod completion_matrix;
mod conventions;
mod docs;
mod doubao;
mod grammar_cases;
mod grammar_matrix;
mod harness;
mod images;

use crate::ai::agent::AgentMode;
use harness::{auth, finish, par_map, Record};

/// About 60k characters, past the full-document limit, so the model only
/// sees the outline and has to read the section it is asked about.
fn long_doc() -> String {
    let topics = [
        "Sampling",
        "Instruments",
        "Interviews",
        "Coding",
        "Validity",
        "Ethics",
    ];
    let mut doc = String::from("# Field study report\n\n");
    for (s, topic) in topics.iter().enumerate() {
        doc.push_str(&format!("## {topic}\n\n"));
        for p in 0..14 {
            let mut para = String::new();
            for k in 0..9 {
                para.push_str(&format!(
                    "In {topic} block {p}, observation {k} noted that site {} reported {} visits over the season, which the team cross-checked against the logbook. ",
                    (s * 31 + p * 7 + k) % 97,
                    (s * 13 + p * 5 + k * 3) % 400
                ));
            }
            doc.push_str(para.trim_end());
            doc.push_str("\n\n");
        }
    }
    // The editor's form: no trailing newline (see docs.rs).
    doc.trim_end().to_string()
}

fn assert_clean(suite: &str, records: Vec<Record>) {
    let failures = finish(suite, records);
    assert!(
        failures.is_empty(),
        "{suite}: {} failed check(s):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// Every agent case on the shipped agent model (or TEXTUS_EVAL_AGENT_MODEL).
#[test]
#[ignore = "live API - see module docs"]
fn live_agent_matrix() {
    let Some(auth) = auth() else { return };
    let model = harness::agent_model();
    let cases = agent_matrix::all_cases();
    let records = par_map(&cases, |case| agent_matrix::run_case(&auth, case, &model));
    assert_clean("agent", records);
}

/// The built-in skills suite (agent_builtin.rs): 56 skill cases and 20
/// routing cases, as their own `agent-builtin` suite so the agent matrix's
/// numbers stay comparable with earlier rounds.
#[test]
#[ignore = "live API - see module docs"]
fn live_agent_builtin() {
    let Some(auth) = auth() else { return };
    let model = harness::agent_model();
    let cases = agent_builtin::all_cases();
    let records = par_map(&cases, |case| agent_matrix::run_case(&auth, case, &model));
    assert_clean("agent-builtin", records);
}

/// The same subset on each current Claude model, so the agent default is
/// chosen on evidence: pass rate, judge scores and latency side by side.
/// Reports only - a weaker model failing checks is the point of comparing.
#[test]
#[ignore = "live API - see module docs"]
fn live_agent_model_comparison() {
    let Some(auth) = auth() else { return };
    let cases: Vec<_> = agent_matrix::all_cases()
        .into_iter()
        .filter(|c| agent_matrix::COMPARISON_CASES.contains(&c.id.as_str()))
        .collect();
    let models = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];
    let jobs: Vec<(usize, &str)> = models
        .iter()
        .flat_map(|m| (0..cases.len()).map(move |i| (i, *m)))
        .collect();
    let records = par_map(&jobs, |(i, model)| {
        agent_matrix::run_case(&auth, &cases[*i], model)
    });
    finish("agent-models", records);
}

/// Every completion case on the shipped writing model.
#[test]
#[ignore = "live API - see module docs"]
fn live_completion_matrix() {
    let Some(auth) = auth() else { return };
    let model = harness::writing_model();
    let cases = completion_matrix::all_cases();
    let records = par_map(&cases, |case| {
        completion_matrix::run_case(&auth, case, &model)
    });
    assert_clean("completion", records);
}

/// Every grammar case on the shipped writing model.
#[test]
#[ignore = "live API - see module docs"]
fn live_grammar_matrix() {
    let Some(auth) = auth() else { return };
    let model = harness::writing_model();
    let cases = grammar_matrix::all_cases();
    let records = par_map(&cases, |case| grammar_matrix::run_case(&auth, case, &model));
    assert_clean("grammar", records);
}

/// Completion and grammar on the default writing model against Sonnet, so
/// the cheap default is kept (or not) on evidence. Reports only.
#[test]
#[ignore = "live API - see module docs"]
fn live_writing_model_comparison() {
    let Some(auth) = auth() else { return };
    let models = ["claude-haiku-5-5", "claude-sonnet-5-5"];
    let completion = completion_matrix::all_cases();
    let jobs: Vec<(usize, &str)> = models
        .iter()
        .flat_map(|m| (0..completion.len()).map(move |i| (i, *m)))
        .collect();
    let records = par_map(&jobs, |(i, model)| {
        completion_matrix::run_case(&auth, &completion[*i], model)
    });
    finish("completion-models", records);
    let grammar = grammar_matrix::all_cases();
    let jobs: Vec<(usize, &str)> = models
        .iter()
        .flat_map(|m| (0..grammar.len()).map(move |i| (i, *m)))
        .collect();
    let records = par_map(&jobs, |(i, model)| {
        grammar_matrix::run_case(&auth, grammar[*i], model)
    });
    finish("grammar-models", records);
}

/// Prompt caching (docs/design/ai-eval.md, "Prompt caching"): every tool step reads
/// everything the step before it sent, and every message after the first
/// reads the system prompt and the history the previous message wrote,
/// instead of paying for them again.
#[test]
#[ignore = "live API - see module docs"]
fn live_agent_caches_across_steps() {
    let Some(auth) = auth() else { return };
    let model = harness::agent_model();
    let ws = crate::ai::workspace::AgentWorkspace::default();
    let setup = harness::AgentSetup {
        model: &model,
        mode: AgentMode::Revise,
        workspace: &ws,
        focus_heading: None,
        ui_language: "en",
        thinking: aicompat::capabilities::ThinkingLevel::Auto,
    };
    let conv = harness::run_conversation(
        &auth,
        &setup,
        &long_doc(),
        &[
            harness::UserTurn::new(
                "Tighten the first paragraph of the 'Coding' section: same facts, fewer words.",
            ),
            harness::UserTurn::new("Now do the same for the second paragraph of that section."),
            harness::UserTurn::new(
                "Which site numbers does the first paragraph of 'Ethics' name? Just list them.",
            ),
        ],
    );
    assert!(conv.error.is_none(), "{:?}", conv.error);
    for (t, outcome) in conv.outcomes.iter().enumerate() {
        for (s, u) in outcome.usage.iter().enumerate() {
            println!(
                "[cache] turn {} step {}: read {}, write {}, input {}, output {}",
                t + 1,
                s + 1,
                u.cache_read_input_tokens,
                u.cache_creation_input_tokens,
                u.input_tokens,
                u.output_tokens
            );
        }
    }
    let first = &conv.outcomes[0].usage;
    assert!(first.len() > 1, "expected a read step before the edit");
    // Within a message: a step's prompt is the previous step's plus what
    // that step added, so it reads all of the previous one from cache.
    for (t, outcome) in conv.outcomes.iter().enumerate() {
        for (s, pair) in outcome.usage.windows(2).enumerate() {
            let sent = pair[0].cache_read_input_tokens + pair[0].cache_creation_input_tokens;
            assert!(
                pair[1].cache_read_input_tokens >= sent,
                "turn {} step {} read {} of the {} cached tokens before it",
                t + 1,
                s + 2,
                pair[1].cache_read_input_tokens,
                sent
            );
        }
    }
    // Across messages: the second reads the system prompt (the first
    // message's history-free prefix); the third also reads the history up
    // to the end of the first exchange, which the second one wrote.
    let opening = |t: usize| conv.outcomes[t].usage[0];
    assert!(
        opening(1).cache_read_input_tokens > 0,
        "message 2 read nothing"
    );
    assert!(
        opening(2).cache_read_input_tokens > opening(1).cache_read_input_tokens,
        "message 3 read {} tokens, no more than message 2's {} - the history wasn't cached",
        opening(2).cache_read_input_tokens,
        opening(1).cache_read_input_tokens
    );
}

/// Thinking levels (capabilities::plan) on the two shipped Claude models:
/// each level's request is accepted, a tool step after a thinking step
/// replays its thinking blocks without tripping the preserved-thinking
/// check (the harness opts every request into it), the next message - with
/// the earlier thinking dropped - is accepted too, and Deep shows readable
/// thinking. Prints each run's steps, thinking, latency and cost.
#[test]
#[ignore = "live API - see module docs"]
fn live_thinking_levels() {
    use aicompat::capabilities::ThinkingLevel;
    let Some(auth) = auth() else { return };
    let ws = crate::ai::workspace::AgentWorkspace::default();
    let models = ["claude-sonnet-5-5", "claude-haiku-5-5"];
    let levels = [
        ThinkingLevel::Fast,
        ThinkingLevel::Auto,
        ThinkingLevel::Deep,
    ];
    let jobs: Vec<(&str, ThinkingLevel)> = models
        .iter()
        .flat_map(|m| levels.iter().map(move |l| (*m, *l)))
        .collect();
    let results = par_map(&jobs, |(model, level)| {
        let setup = harness::AgentSetup {
            model,
            mode: AgentMode::Revise,
            workspace: &ws,
            focus_heading: None,
            ui_language: "en",
            thinking: *level,
        };
        let conv = harness::run_conversation(
            &auth,
            &setup,
            &long_doc(),
            &[
                harness::UserTurn::new(
                    "Tighten the first paragraph of the 'Coding' section: same facts, fewer words.",
                ),
                harness::UserTurn::new("Now do the same for the second paragraph of that section."),
            ],
        );
        (*model, *level, conv)
    });
    let mut failures = Vec::new();
    let mut total = harness::Usage::default();
    for (model, level, conv) in &results {
        let label = format!("{model} {level:?}");
        if let Some(e) = &conv.error {
            failures.push(format!("{label}: {e}"));
            continue;
        }
        for (t, outcome) in conv.outcomes.iter().enumerate() {
            let mut usage = harness::Usage::default();
            for step in &outcome.usage {
                usage.add(model, step);
            }
            println!(
                "[thinking] {label} turn {}: {} steps, {} thinking events / {} chars, {} ms, {} output tokens, ${:.4}",
                t + 1,
                outcome.usage.len(),
                outcome.thinking_events,
                outcome.thinking_chars,
                outcome.latency_ms,
                usage.output,
                usage.cost_usd
            );
            total.merge(&usage);
            if outcome.proposals.is_empty() {
                failures.push(format!("{label} turn {}: no proposal", t + 1));
            }
        }
        let first = &conv.outcomes[0];
        if first.usage.len() < 2 {
            failures.push(format!("{label}: no tool step after the first"));
        }
        if *level == ThinkingLevel::Deep && first.thinking_chars == 0 {
            failures.push(format!("{label}: Deep showed no thinking"));
        }
    }
    println!("[thinking] total ${:.4}", total.cost_usd);
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// Free, no key needed: prints every case id per suite (after
/// TEXTUS_EVAL_FILTER) - what a run would send, for sizing it first.
#[test]
#[ignore = "prints the case list"]
fn list_eval_cases() {
    let agent: Vec<String> = agent_matrix::all_cases()
        .into_iter()
        .map(|c| c.id)
        .collect();
    let completion: Vec<String> = completion_matrix::all_cases()
        .into_iter()
        .map(|c| c.id)
        .collect();
    let grammar: Vec<&str> = grammar_matrix::all_cases().iter().map(|c| c.id).collect();
    let builtin: Vec<String> = agent_builtin::all_cases()
        .into_iter()
        .map(|c| c.id)
        .collect();
    println!("agent ({}): {}", agent.len(), agent.join(" "));
    println!("agent-builtin ({}): {}", builtin.len(), builtin.join(" "));
    println!(
        "completion ({}): {}",
        completion.len(),
        completion.join(" ")
    );
    println!("grammar ({}): {}", grammar.len(), grammar.join(" "));
}

/// Free, no key needed: the built-in skills suite one case per line (id,
/// mode, the user's language, the message), after TEXTUS_EVAL_FILTER, with
/// a per-group count and a cost estimate - for choosing a filter before a
/// paid run.
#[test]
#[ignore = "prints the case list"]
fn list_builtin_cases() {
    let cases = agent_builtin::all_cases();
    let mut groups: std::collections::BTreeMap<String, usize> = Default::default();
    for case in &cases {
        println!("{}", agent_builtin::describe(case));
        let mut parts = case.id.split('/');
        let group = format!(
            "{}/{}",
            parts.next().unwrap_or(""),
            parts.next().unwrap_or("")
        );
        *groups.entry(group).or_default() += 1;
    }
    println!(
        "\n{} case(s): {}",
        cases.len(),
        groups
            .iter()
            .map(|(g, n)| format!("{g} {n}"))
            .collect::<Vec<_>>()
            .join(", ")
    );
    // Round-2 averages: $0.02-0.03 an agent case with TEXTUS_EVAL_JUDGE=0.
    println!(
        "estimated cost without the judge: ${:.2}-{:.2}",
        cases.len() as f64 * 0.02,
        cases.len() as f64 * 0.03
    );
}

/// Free: lists models through the app's own paging and tidying, and checks
/// both shipped defaults are still served.
#[test]
#[ignore = "live API - see module docs"]
fn live_lists_every_model() {
    let Some(auth) = auth() else { return };
    let models = harness::block_on(aicompat::providers::anthropic::list_models(&auth)).unwrap();
    println!("\n[models] {} listed: {}", models.len(), models.join(", "));
    assert!(models
        .iter()
        .any(|m| m == aicompat::providers::anthropic::COMPLETION_MODEL));
    assert!(models.iter().any(|m| *m == harness::agent_model()));
}
