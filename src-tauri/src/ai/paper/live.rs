//! A whole paper written against a real provider, the way the app writes
//! one: research, the outline (approved as it comes), drafting, the review
//! and the finish, pictures from Wikimedia Commons included. `#[ignore]`d -
//! it spends money. The paper, its dossier and outline and what each stage
//! took go to `tmp/live-paper/<time>/`.
//!
//! ```sh
//! cd src-tauri && cargo test --lib live_paper -- --ignored --nocapture
//! ```
//!
//! MiniMax by default, its key read in place from the app's key file (or
//! MINIMAX_API_KEY); TEXTUS_PAPER_TOPIC, TEXTUS_PAPER_GENRE ("paper",
//! "report"), TEXTUS_PAPER_LANGUAGE, TEXTUS_PAPER_CHARS,
//! TEXTUS_PAPER_AT_ONCE and TEXTUS_EVAL_AGENT_MODEL change the run. TEXTUS_PAPER_PROMPTS runs it on
//! prompts of another wording, read from a folder laid out as prompts/ is
//! (prompts.rs): copy the files to change, edit them, and compare the two
//! runs' output - each is kept under its prompts' fingerprint.

use super::*;
use aicompat::capabilities::ThinkingLevel;
use aicompat::providers::{AgentProvider, Endpoint};
use serde_json::json;
use std::time::Instant;

/// The MiniMax key: MINIMAX_API_KEY, else the one saved in the app, read
/// in place and never printed.
fn minimax_key() -> Option<String> {
    if let Ok(key) = std::env::var("MINIMAX_API_KEY") {
        return Some(key);
    }
    let path = std::path::PathBuf::from(std::env::var_os("HOME")?)
        .join("Library/Application Support/com.catvinci.textus/provider_keys.json");
    let keys: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    keys["minimax"]
        .as_str()
        .map(str::to_string)
        .filter(|k| !k.trim().is_empty())
}

fn env_or(name: &str, default: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| default.to_string())
}

#[test]
#[ignore = "spends money: a whole paper on a real provider"]
fn live_paper() {
    let Some(key) = minimax_key() else {
        eprintln!("live_paper: no MiniMax key - skipping");
        return;
    };
    let entry = crate::ai::catalog::find("minimax").expect("minimax");
    let base_url = entry.base_url.expect("base_url");
    let model = env_or("TEXTUS_EVAL_AGENT_MODEL", "MiniMax-M3.1-Flash");
    let agent = AgentProvider {
        id: "minimax".into(),
        model: model.clone(),
        endpoint: Endpoint::ChatCompletions {
            base_url: base_url.to_string(),
            api_key: Some(key),
            vendor: crate::ai::route::chat_vendor(base_url),
            stream_usage: true,
        },
        thinking: ThinkingLevel::default(),
        native_search: None,
        enforce_binding: false,
    };
    // As the app steps it: TEXTUS_PAPER_AT_ONCE calls at once, else
    // MiniMax's.
    let at_once = env_or("TEXTUS_PAPER_AT_ONCE", "0")
        .parse()
        .ok()
        .filter(|n| *n > 0)
        .unwrap_or(entry.paper_at_once);
    let agent = throttle::Throttled::new(&agent, at_once);
    eprintln!("live_paper: {at_once} model calls at once");
    let mut budget = ResearchBudget::for_paper();
    // No image model in this run: AI pictures cost money and need a service.
    budget.limits.images = 0;
    let paper = Paper {
        id: new_id(),
        topic: env_or("TEXTUS_PAPER_TOPIC", "屋顶绿化如何缓解城市热岛效应"),
        genre: serde_json::from_value(json!(env_or("TEXTUS_PAPER_GENRE", "paper")))
            .expect("TEXTUS_PAPER_GENRE"),
        language: env_or("TEXTUS_PAPER_LANGUAGE", "zh"),
        target_chars: env_or("TEXTUS_PAPER_CHARS", "5000").parse().unwrap_or(5000),
        budget,
        stage: PaperStage::Researching,
        sub_helpers: false,
    };
    let out = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../tmp/live-paper")
        .join(format!("{}-{}-{}", paper.id, model, prompts::fingerprint()));
    std::fs::create_dir_all(&out).unwrap();
    let write = |name: &str, text: &str| std::fs::write(out.join(name), text).unwrap();
    let mut stats = serde_json::Map::new();
    stats.insert("prompts".into(), json!(prompts::fingerprint()));
    if let Ok(folder) = std::env::var("TEXTUS_PAPER_PROMPTS") {
        stats.insert("prompts_from".into(), json!(folder));
    }
    let started = Instant::now();
    let lap =
        |stats: &mut serde_json::Map<String, serde_json::Value>, stage: &str, since: Instant| {
            let secs = since.elapsed().as_secs_f64().round();
            eprintln!("live_paper: {stage} took {secs} s");
            stats.insert(format!("{stage}_seconds"), json!(secs));
        };

    tauri::async_runtime::block_on(async {
        eprintln!(
            "live_paper: \"{}\" ({:?}, {}, {} characters) on {model}",
            paper.topic, paper.genre, paper.language, paper.target_chars
        );
        let shared = std::sync::Arc::new(SharedBudget::new(paper.budget));
        let native = crate::ai::web::native_search("minimax", &model);
        let web = crate::ai::web::WebPlan::new(true, native, None, &[]).with_budget(shared.clone());
        let send = |event: PaperEvent| match event {
            PaperEvent::Phase { phase } => eprintln!("live_paper: phase {phase:?}"),
            PaperEvent::Error { message, .. } => {
                eprintln!("live_paper: a helper failed: {message}")
            }
            PaperEvent::Budget { used, .. } => eprintln!(
                "live_paper: used {} searches, {} pages, {} paper lookups",
                used.searches, used.fetches, used.paper_lookups
            ),
            _ => {}
        };

        let t = Instant::now();
        let (tools, ctx) = super::research_tests::kit(None, None, Vec::new());
        let kit = research::Kit {
            tools: &tools,
            ctx: &ctx,
        };
        let dossier = research::research(
            &agent,
            &paper,
            &web,
            &shared,
            &send,
            &kit,
            research::Progress::none(),
        )
        .await
        .expect("research");
        lap(&mut stats, "research", t);
        write(
            "dossier.json",
            &serde_json::to_string_pretty(&dossier).unwrap(),
        );
        stats.insert("notes".into(), json!(dossier.notes.len()));
        stats.insert("sources".into(), json!(dossier.sources.len()));
        stats.insert("budget_used".into(), json!(shared.snapshot().used));

        let paper = Paper {
            budget: shared.snapshot(),
            ..paper.clone()
        };
        let t = Instant::now();
        let outline = outline::make_outline(&agent, &paper, &dossier, &send)
            .await
            .expect("outline");
        lap(&mut stats, "outline", t);
        write(
            "outline.json",
            &serde_json::to_string_pretty(&outline).unwrap(),
        );
        stats.insert("sections_planned".into(), json!(outline.sections.len()));

        let t = Instant::now();
        let mut sections = draft::draft(
            &agent,
            &paper,
            &outline,
            &dossier,
            &[],
            &|i| eprintln!("live_paper: writing section {}", i + 1),
            &mut |i, md: &str| {
                eprintln!(
                    "live_paper: section {} written ({} long)",
                    i + 1,
                    checks::prose_length(md, &paper.language)
                );
                Ok(())
            },
            &|_| {},
            None,
        )
        .await
        .expect("drafting");
        lap(&mut stats, "drafting", t);
        write("draft-before-review.md", &sections.join("\n\n"));

        let t = Instant::now();
        let issues = review::review_all(&agent, &paper, &outline, &dossier, &sections, true).await;
        for issue in &issues {
            eprintln!(
                "live_paper: review, section {}: {} -> {}",
                issue.section + 1,
                issue.problem,
                issue.fix
            );
        }
        let changed = review::revise(
            &agent,
            &paper,
            &outline,
            &dossier,
            &mut sections,
            &issues,
            &|_| {},
            &|_| {},
            None,
        )
        .await;
        lap(&mut stats, "review", t);
        stats.insert("review_issues".into(), json!(issues.len()));
        stats.insert("sections_revised".into(), json!(changed));

        let t = Instant::now();
        let mut sections: Vec<String> =
            web_figures::resolve(&sections, web_figures::find_on_commons)
                .await
                .iter()
                .map(|s| finish::without_pictures(s))
                .collect();
        // No window draws here: only figures known not to draw go.
        for section in &mut sections {
            *section = super::figures::drawable(None, section).await;
        }
        let figures = finish::number_figures(&mut sections, &paper.language);
        let mut dossier = finish::number_citations(&mut sections, &dossier);
        let plain: Vec<String> = sections
            .iter()
            .map(|s| finish::plain_citations(s))
            .collect();
        // As ai_paper_draft finishes: the opening while titles are looked up.
        let ((), opening) = futures_util::future::join(
            finish::title_sources(&mut dossier),
            finish::opening(&agent, &paper, &outline, &plain),
        )
        .await;
        let references = finish::references(
            &sections,
            &dossier,
            finish::references_heading(&paper.language, paper.genre),
        );
        let sections = plain;
        let markdown = finish::assemble(&opening, &sections, references.as_deref());
        lap(&mut stats, "finish", t);
        stats.insert("figures".into(), json!(figures));
        stats.insert(
            "length".into(),
            json!(checks::prose_length(
                &sections.join("\n\n"),
                &paper.language
            )),
        );
        stats.insert(
            "commons_pictures".into(),
            json!(markdown.matches("[Wikimedia Commons](").count()),
        );
        write("paper.md", &markdown);
    });
    stats.insert(
        "total_seconds".into(),
        json!(started.elapsed().as_secs_f64().round()),
    );
    write("stats.json", &serde_json::to_string_pretty(&stats).unwrap());
    eprintln!("live_paper: done - {}", out.display());
    eprintln!("{}", serde_json::to_string_pretty(&stats).unwrap());
}
