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

use super::harness::{block_on, secret};
use crate::ai::images::find;
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
