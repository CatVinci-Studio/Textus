use super::provider::{self, MediaError};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
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
        let request = super::protocols::transcription_request(
            request,
            &config,
            bytes,
            mime,
            extension,
            language.as_deref().or(config.language.as_deref()),
        )?;
        let response = request.send().await.map_err(provider::network_error)?;
        let bytes = provider::read_response(response, 1024 * 1024).await?;
        let json: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| {
            MediaError::new("invalid_response", "Transcription response was not JSON")
        })?;
        super::protocols::transcript(&json, &config.provider)
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
        let (request, config) =
            provider::request_with_voice(&app, "tts", "audio/speech", voice.as_deref())?;
        let voice = voice.or(config.voice.clone()).unwrap_or_default();
        validate_speech(&text, &voice)?;
        let response = super::protocols::synthesis_request(request, &config, &text, &voice)?
            .send()
            .await
            .map_err(provider::network_error)?;
        let (bytes, mime) = super::protocols::speech_audio(response, &config).await?;
        Ok(SpeechAudio {
            data_base64: STANDARD.encode(bytes),
            mime,
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
