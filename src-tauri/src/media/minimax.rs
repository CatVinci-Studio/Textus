//! MiniMax's native media protocol, separate from OpenAI compatibility.
use super::provider::MediaError;
use serde_json::{json, Value};

pub fn image_payload(model: &str, prompt: &str, size: &str) -> Result<Value, MediaError> {
    if prompt.trim().is_empty() || prompt.chars().count() > 1500 {
        return Err(MediaError::new(
            "invalid_request",
            "MiniMax image prompts require 1–1500 characters",
        ));
    }
    let (width, height) = size
        .split_once('x')
        .and_then(|(w, h)| Some((w.parse::<u32>().ok()?, h.parse::<u32>().ok()?)))
        .filter(|(w, h)| {
            (512..=2048).contains(w) && (512..=2048).contains(h) && w % 8 == 0 && h % 8 == 0
        })
        .ok_or_else(|| {
            MediaError::new(
                "invalid_request",
                "MiniMax image dimensions must be multiples of 8 between 512 and 2048",
            )
        })?;
    let mut body = json!({"model": model, "prompt": prompt, "response_format":"url", "n":1});
    match model {
        "image-01" => {
            body["width"] = json!(width);
            body["height"] = json!(height);
        }
        "image-01-live" => {
            body["aspect_ratio"] = json!(match size {
                "1024x1024" => "1:1",
                "1536x1024" => "3:2",
                "1024x1536" => "2:3",
                "1792x1024" => "16:9",
                "1024x1792" => "9:16",
                _ =>
                    return Err(MediaError::new(
                        "invalid_request",
                        "Select a supported MiniMax image aspect ratio"
                    )),
            });
        }
        _ => {
            return Err(MediaError::new(
                "configuration",
                "MiniMax image model must be image-01 or image-01-live",
            ))
        }
    }
    Ok(body)
}

pub fn image_url(response: &Value) -> Result<&str, MediaError> {
    let code = response
        .pointer("/base_resp/status_code")
        .and_then(Value::as_i64)
        .ok_or_else(|| {
            MediaError::new(
                "invalid_response",
                "MiniMax response is missing its status code",
            )
        })?;
    if code != 0 {
        let category = match code {
            1004 | 2049 => "authentication",
            1002 | 1008 | 2056 => "limit",
            _ => "service",
        };
        return Err(MediaError::new(
            category,
            format!("MiniMax image request failed (code {code})"),
        ));
    }
    response
        .pointer("/data/image_urls")
        .and_then(Value::as_array)
        .filter(|images| images.len() == 1)
        .and_then(|images| images[0].as_str())
        .filter(|url| !url.is_empty())
        .ok_or_else(|| {
            MediaError::new("invalid_response", "Expected exactly one MiniMax image URL")
        })
}

pub fn transcription_request(
    request: reqwest::RequestBuilder,
    model: &str,
    bytes: Vec<u8>,
    mime: &str,
    extension: &str,
    language: Option<&str>,
) -> Result<reqwest::RequestBuilder, MediaError> {
    // Browser WebM/MP4 recording containers are converted locally to PCM WAV.
    if model != "asr-1.0" || mime != "audio/wav" {
        return Err(MediaError::new(
            "invalid_audio",
            "MiniMax ASR requires model asr-1.0 and locally converted WAV audio",
        ));
    }
    let file = reqwest::multipart::Part::bytes(bytes)
        .file_name(format!("recording.{extension}"))
        .mime_str(mime)
        .map_err(|_| MediaError::new("invalid_audio", "Invalid audio MIME"))?;
    let form = reqwest::multipart::Form::new()
        .text("model", model.to_owned())
        .text("response_format", "json")
        .text("stream", "false")
        .part("file", file);
    let mut request = request.multipart(form);
    if let Some(language) = language.filter(|l| !l.is_empty()) {
        if !matches!(language, "zh" | "en") {
            return Err(MediaError::new(
                "invalid_request",
                "Select automatic, Chinese or English transcription",
            ));
        }
        request = request.header("language", language);
    }
    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn image_request_uses_native_dimensions_and_single_result() {
        let body = image_payload("image-01", "山水画", "1536x1024").unwrap();
        assert_eq!(
            body,
            json!({"model":"image-01", "prompt":"山水画", "width":1536, "height":1024, "response_format":"url", "n":1})
        );
        assert!(image_payload("image-01", &"中".repeat(1501), "1024x1024").is_err());
        assert!(image_payload("image-01", "x", "999x1024").is_err());
        assert_eq!(
            image_payload("image-01-live", "x", "1536x1024").unwrap()["aspect_ratio"],
            "3:2"
        );
    }

    #[test]
    fn image_response_checks_business_errors_before_reading_result() {
        let success = json!({"data":{"image_urls":["https://example.com/image.png"]}, "base_resp":{"status_code":0}});
        assert_eq!(
            image_url(&success).unwrap(),
            "https://example.com/image.png"
        );
        let error = image_url(&json!({"data":{"image_urls":["https://example.com/image.png"]},"base_resp":{"status_code":1004,"status_msg":"private account details"}})).unwrap_err();
        assert_eq!(error.code, "authentication");
        assert!(!error.message.contains("private"));
        assert!(
            image_url(&json!({"data":{"image_urls":[]},"base_resp":{"status_code":0}})).is_err()
        );
        assert!(
            image_url(&json!({"data":{"image_urls":["a","b"]},"base_resp":{"status_code":0}}))
                .is_err()
        );
        assert!(image_url(&json!({"data":{"image_urls":["a"]}})).is_err());
    }

    #[tokio::test]
    async fn transcription_sends_language_in_header_and_nonstreaming_multipart() {
        let request = transcription_request(
            reqwest::Client::new().post("https://api.minimax.cn/v1/speech_to_text"),
            "asr-1.0",
            vec![0; 44],
            "audio/wav",
            "wav",
            Some("zh"),
        )
        .unwrap()
        .build()
        .unwrap();
        assert_eq!(request.headers()["language"], "zh");
        let body = request.body().unwrap();
        assert!(body.as_bytes().is_none()); // Multipart body remains streamed.
        assert!(transcription_request(
            reqwest::Client::new().post("https://example.com"),
            "asr-1.0",
            vec![0],
            "audio/webm",
            "webm",
            None
        )
        .is_err());
    }
}
