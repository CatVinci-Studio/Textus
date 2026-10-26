//! Live evaluation against the real Anthropic API: a matrix of writing tasks
//! run through the app's own prompts, tools and agent loop, each checked
//! automatically and graded by an LLM judge, so a prompt or model change can
//! be compared run to run instead of by feel. Every live test here is
//! `#[ignore]` - it spends money and needs a key, so CI never runs it (the
//! checking code itself is unit-tested in checks.rs and does run in CI).
//!
//! Run from src-tauri/:
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

mod agent_builtin;
mod agent_everyday;
mod agent_matrix;
mod agent_workspace;
mod checks;
mod checks_builtin;
mod completion_cases;
mod completion_matrix;
mod continuing;
mod conventions;
mod docs;
mod grammar_cases;
mod grammar_matrix;
mod harness;
mod memory_eval;
mod memory_sessions;

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
