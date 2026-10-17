//! Opt-in paid smoke tests. Secrets are loaded inside Rust and never logged.
use super::{image, minimax, provider};
use crate::auth::custom_endpoint::CustomEndpointConfig;

fn request(suffix: &str) -> reqwest::RequestBuilder {
    assert_eq!(
        std::env::var("TEXTUS_MINIMAX_LIVE").as_deref(),
        Ok("1"),
        "Explicitly opt in to paid MiniMax tests"
    );
    let directory = std::path::PathBuf::from(
        std::env::var_os("TEXTUS_MINIMAX_CONFIG_DIR").expect("Set the Textus config directory"),
    );
    let text: CustomEndpointConfig = serde_json::from_slice(
        &std::fs::read(directory.join("custom_endpoint.json"))
            .expect("Read text provider configuration"),
    )
    .expect("Decode text provider configuration");
    let key = provider::minimax_chat_key(&text, "https://api.minimax.cn/v1")
        .expect("Resolve MiniMax text credential");
    aicompat::http::media_client(180)
        .expect("Create media client")
        .post(format!("https://api.minimax.cn/v1/{suffix}"))
        .bearer_auth(key)
}

#[tokio::test]
#[ignore = "Paid MiniMax image request; requires explicit local opt-in"]
async fn minimax_live_image() {
    let config = provider::MediaProviderConfig {
        provider: "minimax".into(),
        endpoint: "https://api.minimax.cn/v1".into(),
        model: "image-01".into(),
        voice: None,
        credential_source: Some("minimax-chat".into()),
    };
    let generated = image::generate_with(
        request("image_generation"),
        config,
        "A simple blue circle on a plain white background, clean flat illustration, no text",
        "1024x1024",
        None,
    )
    .await
    .expect("MiniMax image generation and safe download");
    let output = std::path::PathBuf::from(
        std::env::var_os("TEXTUS_MEDIA_TEST_OUTPUT").expect("Set a local test output directory"),
    );
    std::fs::create_dir_all(&output).unwrap();
    let path = output.join(format!("minimax-live-image.{}", generated.ext));
    crate::atomic::write(&path, generated.bytes).await.unwrap();
    println!(
        "MiniMax image validated and saved: {} ({}×{})",
        path.display(),
        generated.width,
        generated.height
    );
}

#[tokio::test]
#[ignore = "Paid MiniMax transcription request; uses synthetic local speech, never microphone audio"]
async fn minimax_live_speech_input() {
    let input = std::path::PathBuf::from(
        std::env::var_os("TEXTUS_STT_TEST_WAV").expect("Set a synthetic PCM WAV fixture"),
    );
    let bytes = std::fs::read(input).unwrap();
    assert!(bytes.starts_with(b"RIFF") && bytes.len() < super::speech::MAX_RECORDING_BYTES);
    let response = minimax::transcription_request(
        request("speech_to_text"),
        "asr-1.0",
        bytes,
        "audio/wav",
        "wav",
        Some("en"),
    )
    .unwrap()
    .send()
    .await
    .map_err(provider::network_error)
    .unwrap();
    let raw = provider::read_response(response, 1024 * 1024)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&raw).unwrap();
    let text = json
        .get("text")
        .and_then(|v| v.as_str())
        .expect("Recognized text");
    assert!(
        text.to_lowercase().contains("speech"),
        "Synthetic fixture should mention speech"
    );
    println!("MiniMax synthetic speech recognized: {text}");
}
