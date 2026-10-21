//! Live checks of the image models (ai::images) against the services
//! themselves: one picture from each service whose key is set, with the
//! cheapest model the catalog offers there and the smallest size it makes,
//! through the same aicompat::images request the app sends. It checks that
//! the request is accepted and the answer reads as a picture, not how good
//! the picture is. About $0.01 at OpenAI, $0.03 at Google, 0.12 to 0.18 CNY
//! at Ark and DashScope; Zhipu's CogView-3 Flash is free.
//!
//! Keys, in the environment or .env.local (harness::secret): OPENAI_API_KEY,
//! GEMINI_API_KEY, VOLCENGINE_ARK_API_KEY, DASHSCOPE_API_KEY, ZHIPU_API_KEY,
//! SILICONFLOW_API_KEY. A service without its key is skipped. Run from
//! src-tauri/:
//!   cargo test --lib live_eval::images -- --ignored --nocapture
//!
//! The agent cases at the end run the agent on Claude (ANTHROPIC_API_KEY)
//! with generate_image offered and an image model that makes nothing
//! (ImageRun::offline): what the model does with the tool, for no picture's
//! cost. TEXTUS_EVAL_REAL_PICTURES=1 makes the pictures for real, with
//! Seedream (VOLCENGINE_ARK_API_KEY), and waits for each one the way the
//! frontend does (ai_generated_image).

use super::harness::{self, auth, block_on, secret, AgentSetup, UserTurn};
use crate::ai::agent::AgentMode;
use crate::ai::images::{find, ImageRun};
use crate::ai::workspace;
use aicompat::images::{generate, Aspect, ImageTarget};

/// A description no content check should stop, and no literary text.
const PROMPT: &str = "A small red paper boat on a calm blue pond, flat illustration, no text";

fn one_picture(provider: &str, key_var: &str) {
    let Some(key) = secret(key_var) else {
        eprintln!("live_eval: no {key_var} - skipping {provider} images");
        return;
    };
    let entry = find(provider).expect("in the image catalog");
    // The last model listed is the cheapest.
    let model = entry.models.last().expect("a model");
    let started = std::time::Instant::now();
    let image = block_on(generate(
        &ImageTarget {
            api: entry.api,
            base_url: entry.base_url.expect("a built-in address"),
            api_key: &key,
            model,
        },
        PROMPT,
        Aspect::Square,
    ))
    .unwrap_or_else(|e| panic!("{provider}/{model}: {e}"));
    eprintln!(
        "live_eval: {provider}/{model} made a {} x {} {} of {} KB in {:.1} s",
        image.width,
        image.height,
        image.ext,
        image.bytes.len() / 1024,
        started.elapsed().as_secs_f64()
    );
    assert!(image.width >= 512 && image.height >= 512);
}

#[test]
#[ignore = "spends money; needs OPENAI_API_KEY"]
fn openai_makes_a_picture() {
    one_picture("openai", "OPENAI_API_KEY");
}

#[test]
#[ignore = "spends money; needs GEMINI_API_KEY"]
fn gemini_makes_a_picture() {
    one_picture("google", "GEMINI_API_KEY");
}

#[test]
#[ignore = "spends money; needs VOLCENGINE_ARK_API_KEY"]
fn seedream_makes_a_picture() {
    one_picture("doubao", "VOLCENGINE_ARK_API_KEY");
}

#[test]
#[ignore = "spends money; needs DASHSCOPE_API_KEY"]
fn qwen_image_makes_a_picture() {
    one_picture("qwen", "DASHSCOPE_API_KEY");
}

#[test]
#[ignore = "needs ZHIPU_API_KEY"]
fn cogview_makes_a_picture() {
    one_picture("zhipu", "ZHIPU_API_KEY");
}

#[test]
#[ignore = "spends money; needs SILICONFLOW_API_KEY"]
fn siliconflow_makes_a_picture() {
    one_picture("siliconflow", "SILICONFLOW_API_KEY");
}

/// Writes in an empty document with a picture asked for: what the agent
/// called, and what came of each call.
fn write_with_picture(message: &str, ui_language: &str) -> Vec<serde_json::Value> {
    let Some(auth) = auth() else {
        eprintln!("live_eval: no ANTHROPIC_API_KEY - skipping");
        return Vec::new();
    };
    let ws = workspace::load_layers(None, None, None, &[]);
    let real = std::env::var("TEXTUS_EVAL_REAL_PICTURES").as_deref() == Ok("1");
    let pictures = if real {
        let key = secret("VOLCENGINE_ARK_API_KEY").expect("VOLCENGINE_ARK_API_KEY");
        ImageRun::live("doubao", key, 2).expect("doubao in the image catalog")
    } else {
        ImageRun::offline(2)
    };
    let model = harness::agent_model();
    let setup = AgentSetup {
        model: &model,
        mode: AgentMode::Write,
        workspace: &ws,
        focus_heading: None,
        ui_language,
        thinking: aicompat::capabilities::ThinkingLevel::Auto,
        pictures: Some(&pictures),
    };
    let conv = harness::run_conversation(&auth, &setup, "", &[UserTurn::new(message)]);
    assert!(conv.error.is_none(), "{:?}", conv.error);
    let outcome = &conv.outcomes[0];
    for call in &outcome.calls {
        eprintln!(
            "live_eval: {} {}\n  -> {}",
            call["name"],
            harness::clip(&call["args"].to_string(), 300),
            harness::clip(call["result"].as_str().unwrap_or(""), 200)
        );
    }
    eprintln!("live_eval: reply: {}", outcome.reply);
    if real {
        for call in &outcome.calls {
            let Some(id) = call["args"]["image"]["id"].as_str() else {
                continue;
            };
            let started = std::time::Instant::now();
            let picture = block_on(crate::ai::images::ai_generated_image(id.to_string()))
                .unwrap_or_else(|e| panic!("picture {id}: {e}"));
            eprintln!(
                "live_eval: picture {id} came {:.1} s after the reply: {} bytes of base64",
                started.elapsed().as_secs_f64(),
                picture.data_base64_len()
            );
        }
    }
    outcome.calls.clone()
}

/// A picture asked for in the same breath as the text, on an empty page,
/// is made - not given up on because the text it goes with isn't in the
/// document yet.
#[test]
#[ignore = "live API - see module docs"]
fn an_empty_page_gets_its_text_and_its_picture() {
    for (message, lang) in [
        ("写一篇三段的短文，讲秋天的港口，并配一张图。", "zh"),
        (
            "Write a three-paragraph piece about a harbour in autumn, with a picture.",
            "en",
        ),
    ] {
        let calls = write_with_picture(message, lang);
        if calls.is_empty() {
            return;
        }
        let made = calls.iter().any(|c| {
            c["name"] == "generate_image"
                && c["result"].as_str().is_some_and(|r| {
                    r.starts_with("Image proposed") || r.starts_with("Picture being made")
                })
        });
        assert!(made, "{message}: no picture was made");
        let texts: Vec<&str> = calls
            .iter()
            .filter(|c| c["name"] == "propose_edit")
            .filter_map(|c| c["args"]["text"].as_str())
            .collect();
        assert!(!texts.is_empty(), "{message}: no text was proposed");
        // A picture asked for before the text is in it, where it goes.
        for slot in calls
            .iter()
            .filter(|c| c["name"] == "generate_image" && c["args"]["action"] == "in_text")
        {
            let id = slot["args"]["image"]["id"].as_str().unwrap_or("-");
            assert!(
                texts
                    .iter()
                    .any(|t| t.contains(&format!("(textus-generated:{id})"))),
                "{message}: picture {id} isn't in the text"
            );
        }
    }
}
