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
        memory: None,
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
        for id in picture_ids(&outcome.calls) {
            let started = std::time::Instant::now();
            let picture = block_on(crate::ai::images::ai_generated_image(id.clone()))
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

/// The text of each proposal that went through.
fn proposed_texts(calls: &[serde_json::Value]) -> Vec<&str> {
    calls
        .iter()
        .filter(|c| {
            c["name"] == "propose_edit"
                && c["result"]
                    .as_str()
                    .is_some_and(|r| r.starts_with("Edit proposed"))
        })
        .filter_map(|c| c["args"]["text"].as_str())
        .collect()
}

/// The pictures in the proposed text, and those generate_image put next
/// to text: every picture the request made, by id, as often as it is used.
fn picture_ids(calls: &[serde_json::Value]) -> Vec<String> {
    const SRC: &str = "textus-generated:";
    let mut ids: Vec<String> = proposed_texts(calls)
        .iter()
        .flat_map(|text| {
            text.match_indices(SRC)
                .map(|(at, _)| &text[at + SRC.len()..])
        })
        .map(|rest| {
            rest.chars()
                .take_while(|c| c.is_ascii_alphanumeric())
                .collect()
        })
        .collect();
    ids.extend(
        calls
            .iter()
            .filter(|c| c["name"] == "generate_image")
            .filter_map(|c| c["args"]["image"]["id"].as_str().map(str::to_string)),
    );
    ids
}

/// A picture asked for in the same breath as the text, on an empty page,
/// is written into that text - in one step, with no picture asked for
/// before it.
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
        let texts = proposed_texts(&calls);
        assert!(!texts.is_empty(), "{message}: no text was proposed");
        assert!(
            texts.iter().any(|t| t.contains("](textus-generated:")),
            "{message}: no picture in the text"
        );
        assert!(
            !texts.iter().any(|t| t.contains("textus-picture:")),
            "{message}: a picture line left unplaced"
        );
    }
}

/// A long piece with two pictures: both written into the text, each
/// once, in the same step as the text.
#[test]
#[ignore = "live API - see module docs"]
fn a_long_piece_gets_both_its_pictures_each_once() {
    let started = std::time::Instant::now();
    let calls = write_with_picture(
        "写一篇 1200 字左右的文章，讲一个港口的四季，配两张图。",
        "zh",
    );
    if calls.is_empty() {
        return;
    }
    eprintln!(
        "live_eval: the request took {:.1} s",
        started.elapsed().as_secs_f64()
    );
    let ids = picture_ids(&calls);
    assert_eq!(ids.len(), 2, "{ids:?}");
    assert_ne!(ids[0], ids[1], "one picture used twice");
    // No hidden draft: the text isn't written out in a check first.
    let drafts = calls
        .iter()
        .filter(|c| {
            (c["name"] == "measure_text" || c["name"] == "check_conventions")
                && c["args"]["text"]
                    .as_str()
                    .is_some_and(|t| t.chars().count() > 300)
        })
        .count();
    assert_eq!(
        drafts, 0,
        "the text was drafted in a check before it was proposed"
    );
}
