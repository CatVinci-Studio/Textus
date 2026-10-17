use super::provider::{self, MediaError};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::json;
use tauri::AppHandle;

pub const MAX_RECORDING_BYTES: usize = 25 * 1024 * 1024;

fn validate_recording(mime: &str, size: usize) -> Result<(&str, &str), MediaError> {
    if size == 0 || size > MAX_RECORDING_BYTES {
        return Err(MediaError::new(
            "limit",
            "Record between 1 byte and 25 MiB of audio",
        ));
    }
    match mime.split(';').next().unwrap_or("").trim() {
        "audio/webm" => Ok(("audio/webm", "webm")),
        "audio/mp4" | "audio/x-m4a" => Ok(("audio/mp4", "m4a")),
        "audio/wav" | "audio/x-wav" => Ok(("audio/wav", "wav")),
        "audio/mpeg" => Ok(("audio/mpeg", "mp3")),
        "audio/ogg" => Ok(("audio/ogg", "ogg")),
        _ => Err(MediaError::new(
            "invalid_audio",
            "Unsupported recording format",
        )),
    }
}

fn validate_speech(text: &str, voice: &str) -> Result<(), MediaError> {
    if text.trim().is_empty()
        || text.chars().count() > 3000
        || voice.trim().is_empty()
        || voice.len() > 100
    {
        return Err(MediaError::new(
            "invalid_request",
            "Speech requires 1–3000 characters and a configured voice",
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn media_transcribe(
    app: AppHandle,
    request_id: String,
    data_base64: String,
    mime: String,
    language: Option<String>,
) -> Result<String, MediaError> {
    provider::cancellable(&request_id, 120, async {
        if data_base64.len() > MAX_RECORDING_BYTES.div_ceil(3) * 4 {
            return Err(MediaError::new("limit", "Recording exceeds 25 MiB"));
        }
        let bytes = STANDARD
            .decode(data_base64)
            .map_err(|_| MediaError::new("invalid_audio", "Invalid recording data"))?;
        let (mime, extension) = validate_recording(&mime, bytes.len())?;
        let (request, config) = provider::request(&app, "stt", "audio/transcriptions")?;
        let request = if config.provider == "minimax" {
            super::minimax::transcription_request(
                request,
                &config.model,
                bytes,
                mime,
                extension,
                language.as_deref(),
            )?
        } else {
            let file = reqwest::multipart::Part::bytes(bytes)
                .file_name(format!("recording.{extension}"))
                .mime_str(mime)
                .map_err(|_| MediaError::new("invalid_audio", "Invalid recording MIME"))?;
            let mut form = reqwest::multipart::Form::new()
                .text("model", config.model)
                .text("response_format", "json")
                .part("file", file);
            if let Some(language) = language.filter(|l| !l.is_empty()) {
                if !matches!(language.as_str(), "en" | "zh") {
                    return Err(MediaError::new(
                        "invalid_request",
                        "Select automatic, Chinese or English transcription",
                    ));
                }
                form = form.text("language", language);
            }
            request.multipart(form)
        };
        let response = request.send().await.map_err(provider::network_error)?;
        let bytes = provider::read_response(response, 1024 * 1024).await?;
        let json: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| {
            MediaError::new("invalid_response", "Transcription response was not JSON")
        })?;
        json.get("text")
            .and_then(|s| s.as_str())
            .map(str::to_owned)
            .ok_or_else(|| {
                MediaError::new(
                    "invalid_response",
                    "Transcription response did not contain text",
                )
            })
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechAudio {
    data_base64: String,
    mime: &'static str,
}

#[tauri::command]
pub async fn media_synthesize(
    app: AppHandle,
    request_id: String,
    text: String,
    voice: Option<String>,
) -> Result<SpeechAudio, MediaError> {
    provider::cancellable(&request_id, 120, async {
        let (request, config) = provider::request(&app, "tts", "audio/speech")?;
        let voice = voice.or(config.voice).unwrap_or_default();
        validate_speech(&text, &voice)?;
        let response = request
            .json(&json!({"model":config.model,"input":text,"voice":voice,"response_format":"mp3"}))
            .send()
            .await
            .map_err(provider::network_error)?;
        if let Some(mime) = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
        {
            if !mime.starts_with("audio/") && !mime.starts_with("application/octet-stream") {
                return Err(MediaError::new(
                    "invalid_response",
                    "Speech provider returned non-audio content",
                ));
            }
        }
        let bytes = provider::read_response(response, 15 * 1024 * 1024).await?;
        if bytes.is_empty() {
            return Err(MediaError::new(
                "invalid_response",
                "Speech provider returned empty audio",
            ));
        }
        Ok(SpeechAudio {
            data_base64: STANDARD.encode(bytes),
            mime: "audio/mpeg",
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_audio_before_upload() {
        assert!(validate_recording("audio/webm;codecs=opus", 100).is_ok());
        assert!(validate_recording("audio/mp4", 100).is_ok());
        assert!(validate_recording("text/html", 100).is_err());
        assert!(validate_recording("audio/webm", 0).is_err());
        assert!(validate_recording("audio/webm", 25 * 1024 * 1024 + 1).is_err());
    }
    #[test]
    fn speech_input_is_bounded_and_voice_is_required() {
        assert!(validate_speech("Hello 你好", "alloy").is_ok());
        assert!(validate_speech(&"中".repeat(3001), "alloy").is_err());
        assert!(validate_speech("", "alloy").is_err());
        assert!(validate_speech("Hello", "").is_err());
    }
}
