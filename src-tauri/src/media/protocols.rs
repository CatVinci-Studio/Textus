//! Provider-specific wire protocols. Credentials never enter serialized settings.
use super::provider::{self, MediaError, MediaProviderConfig};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

pub fn known_provider(p: &str) -> bool {
    matches!(
        p,
        "system"
            | "openai"
            | "openai-compatible"
            | "minimax"
            | "elevenlabs"
            | "deepgram"
            | "gemini"
            | "dashscope"
            | "azure-speech"
            | "siliconflow"
            | "groq"
            | "together"
            | "volcengine"
    )
}
pub fn supports(p: &str, c: &str) -> bool {
    match c {
        "stt" => matches!(
            p,
            "system"
                | "openai"
                | "openai-compatible"
                | "minimax"
                | "elevenlabs"
                | "deepgram"
                | "dashscope"
                | "azure-speech"
                | "siliconflow"
                | "groq"
        ),
        "tts" => matches!(
            p,
            "openai"
                | "openai-compatible"
                | "minimax"
                | "elevenlabs"
                | "deepgram"
                | "gemini"
                | "dashscope"
                | "azure-speech"
                | "siliconflow"
                | "groq"
                | "together"
        ),
        "image" => matches!(
            p,
            "openai"
                | "openai-compatible"
                | "minimax"
                | "gemini"
                | "dashscope"
                | "siliconflow"
                | "together"
                | "volcengine"
        ),
        _ => false,
    }
}
pub fn route(
    c: &MediaProviderConfig,
    capability: &str,
    compatible: &str,
) -> Result<String, MediaError> {
    if !supports(&c.provider, capability) || c.provider == "system" {
        return Err(MediaError::new(
            "configuration",
            "Unsupported remote media capability",
        ));
    }
    Ok(match (c.provider.as_str(), capability) {
        ("minimax", "stt") => "speech_to_text".into(),
        ("minimax", "tts") => "t2a_v2".into(),
        ("minimax", "image") => "image_generation".into(),
        ("elevenlabs", "stt") => "speech-to-text".into(),
        ("elevenlabs", "tts") => {
            let voice = c.voice.as_deref().unwrap_or("");
            if voice.is_empty()
                || !voice
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            {
                return Err(MediaError::new(
                    "configuration",
                    "Configure an ElevenLabs voice ID",
                ));
            }
            format!("text-to-speech/{voice}")
        }
        ("deepgram", "stt") => "listen".into(),
        ("deepgram", "tts") => "speak".into(),
        ("gemini", _) => {
            if !c
                .model
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.' || b == b'_')
            {
                return Err(MediaError::new("configuration", "Invalid Gemini model ID"));
            }
            format!("models/{}:generateContent", c.model)
        }
        ("dashscope", _) => "services/aigc/multimodal-generation/generation".into(),
        ("azure-speech", "stt") => "speech/recognition/conversation/cognitiveservices/v1".into(),
        ("azure-speech", "tts") => "cognitiveservices/v1".into(),
        _ => compatible.into(),
    })
}
pub fn authorize(r: reqwest::RequestBuilder, p: &str, key: &str) -> reqwest::RequestBuilder {
    match p {
        "elevenlabs" => r.header("xi-api-key", key),
        "deepgram" => r.header("Authorization", format!("Token {key}")),
        "gemini" => r.header("x-goog-api-key", key),
        "azure-speech" => r.header("Ocp-Apim-Subscription-Key", key),
        _ => r.bearer_auth(key),
    }
}
fn invalid(message: &str) -> MediaError {
    MediaError::new("invalid_response", message)
}
fn language_name(language: Option<&str>) -> Result<&'static str, MediaError> {
    Ok(match language.unwrap_or("").split('-').next().unwrap_or("") {
        ""|"auto"=>"Auto", "en"=>"English", "zh"=>"Chinese", "de"=>"German", "it"=>"Italian", "pt"=>"Portuguese", "es"=>"Spanish", "ja"=>"Japanese", "ko"=>"Korean", "fr"=>"French", "ru"=>"Russian",
        _=>return Err(MediaError::new("configuration","This Qwen TTS adapter supports Chinese, English, German, Italian, Portuguese, Spanish, Japanese, Korean, French and Russian")),
    })
}
pub fn transcription_request(
    r: reqwest::RequestBuilder,
    c: &MediaProviderConfig,
    bytes: Vec<u8>,
    mime: &str,
    extension: &str,
    language: Option<&str>,
) -> Result<reqwest::RequestBuilder, MediaError> {
    let language = language.filter(|l| !l.is_empty() && *l != "auto");
    if language.is_some_and(|l| !provider::valid_language(l)) {
        return Err(MediaError::new(
            "invalid_request",
            "Invalid transcription language",
        ));
    }
    match c.provider.as_str() {
        "minimax" => {
            super::minimax::transcription_request(r, &c.model, bytes, mime, extension, language)
        }
        "deepgram" => {
            let mut r = r.query(&[("model", c.model.as_str()), ("smart_format", "true")]);
            if let Some(l) = language {
                r = r.query(&[("language", l)]);
            } else {
                r = r.query(&[("detect_language", "true")]);
            }
            Ok(r.header("Content-Type", mime).body(bytes))
        }
        "azure-speech" => {
            validate_azure_wav(&bytes, mime)?;
            let language = language.unwrap_or("en-US");
            let language = match language {
                "en" => "en-US",
                "zh" => "zh-CN",
                other => other,
            };
            Ok(r.query(&[("language", language), ("format", "simple")])
                .header(
                    "Content-Type",
                    "audio/wav; codecs=audio/pcm; samplerate=16000",
                )
                .body(bytes))
        }
        "dashscope" => {
            if !matches!(mime, "audio/wav" | "audio/mpeg" | "audio/mp4" | "audio/ogg")
                || bytes.len().div_ceil(3) * 4 > 10 * 1024 * 1024
            {
                return Err(MediaError::new(
                    "invalid_audio",
                    "Qwen ASR requires WAV/MP3/MP4/OGG audio under 10 MiB after base64 encoding",
                ));
            }
            let mut body = json!({"model":c.model,"input":{"messages":[{"role":"user","content":[{"audio":format!("data:{mime};base64,{}",STANDARD.encode(bytes))}]}]},"parameters":{"result_format":"message","asr_options":{"enable_itn":false}}});
            if let Some(l) = language {
                body["parameters"]["asr_options"]["language"] =
                    json!(l.split('-').next().unwrap_or(l).to_ascii_lowercase());
            }
            Ok(r.json(&body))
        }
        _ => {
            let file = reqwest::multipart::Part::bytes(bytes)
                .file_name(format!("recording.{extension}"))
                .mime_str(mime)
                .map_err(|_| MediaError::new("invalid_audio", "Invalid recording MIME"))?;
            let eleven = c.provider == "elevenlabs";
            let mut form = reqwest::multipart::Form::new()
                .text(if eleven { "model_id" } else { "model" }, c.model.clone())
                .part("file", file);
            if !eleven && c.provider != "siliconflow" {
                form = form.text("response_format", "json");
            }
            if let Some(l) = language {
                form = form.text(
                    if eleven { "language_code" } else { "language" },
                    l.split('-').next().unwrap_or(l).to_ascii_lowercase(),
                );
            }
            Ok(r.multipart(form))
        }
    }
}
fn validate_azure_wav(bytes: &[u8], mime: &str) -> Result<(), MediaError> {
    // Browser conversion produces canonical PCM16 mono 16 kHz WAV, at most 60 seconds.
    if mime != "audio/wav"
        || bytes.len() < 44
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WAVE"
        || &bytes[12..16] != b"fmt "
        || u16::from_le_bytes([bytes[20], bytes[21]]) != 1
        || u16::from_le_bytes([bytes[22], bytes[23]]) != 1
        || u32::from_le_bytes(bytes[24..28].try_into().unwrap()) != 16000
        || u16::from_le_bytes([bytes[34], bytes[35]]) != 16
        || bytes.len() > 44 + 16000 * 2 * 60
    {
        return Err(MediaError::new(
            "invalid_audio",
            "Azure short-audio recognition requires PCM16 mono 16 kHz WAV of at most 60 seconds",
        ));
    }
    Ok(())
}
pub fn transcript(value: &Value, p: &str) -> Result<String, MediaError> {
    let text = match p {
        "deepgram" => value.pointer("/results/channels/0/alternatives/0/transcript"),
        "azure-speech" => match value.get("RecognitionStatus").and_then(Value::as_str) {
            Some("Success") => value.get("DisplayText"),
            Some("NoMatch" | "InitialSilenceTimeout" | "BabbleTimeout") => return Ok(String::new()),
            _ => return Err(invalid("Azure Speech did not recognize the audio")),
        },
        "dashscope" => value.pointer("/output/choices/0/message/content/0/text"),
        _ => value.get("text"),
    };
    text.and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| invalid("Transcription response did not contain text"))
}
fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
pub fn synthesis_request(
    r: reqwest::RequestBuilder,
    c: &MediaProviderConfig,
    text: &str,
    voice: &str,
) -> Result<reqwest::RequestBuilder, MediaError> {
    Ok(match c.provider.as_str() {
        "minimax"=>r.json(&json!({"model":c.model,"text":text,"stream":false,"output_format":"hex","voice_setting":{"voice_id":voice,"speed":1,"vol":1,"pitch":0},"audio_setting":{"sample_rate":32000,"bitrate":128000,"format":"mp3","channel":1}})),
        "elevenlabs"=>{
            let mut body=json!({"model_id":c.model,"text":text});
            if let Some(language)=c.language.as_deref().filter(|l| !l.is_empty() && *l!="auto") {body["language_code"]=json!(language.split('-').next().unwrap_or(language));}
            r.query(&[("output_format","mp3_44100_128")]).json(&body)
        },
        "deepgram"=>r.query(&[("model",c.model.as_str()),("encoding","mp3")]).json(&json!({"text":text})),
        "gemini"=>{
            let voice_config=if c.model.starts_with("gemini-3.8-") {json!({"voice":voice})} else {json!({"prebuiltVoiceConfig":{"voiceName":voice}})};
            r.json(&json!({"contents":[{"role":"user","parts":[{"text":text}]}],"generationConfig":{"responseModalities":["AUDIO"],"speechConfig":{"voiceConfig":voice_config}}}))
        }
        "dashscope"=>{
            if text.chars().count()>600 {return Err(MediaError::new("limit","Qwen TTS accepts at most 600 characters per segment"));}
            r.json(&json!({"model":c.model,"input":{"text":text,"voice":voice,"language_type":language_name(c.language.as_deref())?}}))
        }
        "azure-speech"=>{
            let language=c.language.as_deref().filter(|l|!l.is_empty() && *l!="auto").unwrap_or("en-US");
            r.header("Content-Type","application/ssml+xml").header("X-Microsoft-OutputFormat","audio-24khz-48kbitrate-mono-mp3").header("User-Agent","Textus").body(format!("<speak version='1.0' xml:lang='{}'><voice name='{}'>{}</voice></speak>",escape_xml(language),escape_xml(voice),escape_xml(text)))
        }
        _=>r.json(&json!({"model":c.model,"input":text,"voice":voice,"response_format":if c.provider=="groq" {"wav"} else {"mp3"}})),
    })
}
pub fn decode_hex(value: &str) -> Result<Vec<u8>, MediaError> {
    if !value.len().is_multiple_of(2) || value.len() > 30 * 1024 * 1024 {
        return Err(invalid("Invalid MiniMax audio encoding"));
    }
    value
        .as_bytes()
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| {
            let digit = |b: u8| match b {
                b'0'..=b'9' => Some(b - b'0'),
                b'a'..=b'f' => Some(b - b'a' + 10),
                b'A'..=b'F' => Some(b - b'A' + 10),
                _ => None,
            };
            Ok(
                digit(c[0]).ok_or_else(|| invalid("Invalid MiniMax audio encoding"))? * 16
                    + digit(c[1]).ok_or_else(|| invalid("Invalid MiniMax audio encoding"))?,
            )
        })
        .collect()
}
pub fn pcm_wav(pcm: Vec<u8>, rate: u32) -> Result<Vec<u8>, MediaError> {
    if pcm.is_empty()
        || !pcm.len().is_multiple_of(2)
        || pcm.len() > 15 * 1024 * 1024
        || !(8000..=48000).contains(&rate)
    {
        return Err(invalid("Invalid PCM speech audio"));
    }
    let len = pcm.len() as u32;
    let mut wav = Vec::with_capacity(44 + pcm.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(len + 36).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&rate.to_le_bytes());
    wav.extend_from_slice(&(rate * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&len.to_le_bytes());
    wav.extend_from_slice(&pcm);
    Ok(wav)
}
fn secure_result_url(url: &str) -> Result<String, MediaError> {
    // DashScope OSS responses may advertise HTTP. Fetch only via HTTPS; never downgrade.
    let mut parsed = reqwest::Url::parse(url).map_err(|_| invalid("Invalid media result URL"))?;
    if parsed.scheme() == "http"
        && parsed
            .host_str()
            .is_some_and(|h| h.ends_with(".aliyuncs.com"))
        && parsed.port().is_none_or(|p| p == 80)
    {
        parsed
            .set_scheme("https")
            .map_err(|_| invalid("Invalid media result URL"))?;
        parsed
            .set_port(None)
            .map_err(|_| invalid("Invalid media result URL"))?;
    }
    Ok(parsed.to_string())
}
fn inline_data(value: &Value, kind: &str) -> Result<(Vec<u8>, String), MediaError> {
    let parts = value
        .pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("Gemini response has no generated content"))?;
    let inline = parts
        .iter()
        .filter_map(|p| p.get("inlineData").or_else(|| p.get("inline_data")))
        .find(|p| {
            p.get("mimeType")
                .or_else(|| p.get("mime_type"))
                .and_then(Value::as_str)
                .is_some_and(|m| m.starts_with(kind))
        })
        .ok_or_else(|| invalid("Gemini response has no generated media"))?;
    let mime = inline
        .get("mimeType")
        .or_else(|| inline.get("mime_type"))
        .and_then(Value::as_str)
        .unwrap()
        .to_owned();
    let bytes = STANDARD
        .decode(
            inline
                .get("data")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("Missing generated media data"))?,
        )
        .map_err(|_| invalid("Invalid generated media base64"))?;
    Ok((bytes, mime))
}
pub async fn speech_audio(
    response: reqwest::Response,
    c: &MediaProviderConfig,
) -> Result<(Vec<u8>, &'static str), MediaError> {
    let native_json = matches!(c.provider.as_str(), "minimax" | "gemini" | "dashscope");
    let content_type = response
        .headers()
        .get("Content-Type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let raw = provider::read_response(
        response,
        if native_json {
            31 * 1024 * 1024
        } else {
            15 * 1024 * 1024
        },
    )
    .await?;
    let bytes = if native_json {
        let value: Value = serde_json::from_slice(&raw)
            .map_err(|_| invalid("Speech provider returned invalid JSON"))?;
        match c.provider.as_str() {
            "minimax" => {
                if value
                    .pointer("/base_resp/status_code")
                    .and_then(Value::as_i64)
                    != Some(0)
                {
                    return Err(MediaError::new(
                        "service",
                        "MiniMax speech synthesis failed",
                    ));
                }
                decode_hex(
                    value
                        .pointer("/data/audio")
                        .and_then(Value::as_str)
                        .ok_or_else(|| invalid("MiniMax returned no audio"))?,
                )?
            }
            "gemini" => {
                let (audio, mime) = inline_data(&value, "audio/")?;
                if mime.starts_with("audio/L16") || mime.starts_with("audio/pcm") {
                    let rate = mime
                        .split(';')
                        .find_map(|p| p.trim().strip_prefix("rate="))
                        .and_then(|p| p.parse().ok())
                        .unwrap_or(24000);
                    pcm_wav(audio, rate)?
                } else if matches!(mime.as_str(), "audio/wav" | "audio/x-wav" | "audio/mpeg") {
                    audio
                } else {
                    return Err(invalid("Gemini returned unsupported speech encoding"));
                }
            }
            "dashscope" => {
                let url = value
                    .pointer("/output/audio/url")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("Qwen returned no audio URL"))?;
                super::image::download_media(&secure_result_url(url)?, 15 * 1024 * 1024).await?
            }
            _ => unreachable!(),
        }
    } else {
        if !content_type.is_empty()
            && !content_type.starts_with("audio/")
            && !content_type.starts_with("application/octet-stream")
        {
            return Err(invalid("Speech provider returned non-audio content"));
        }
        raw
    };
    if bytes.is_empty() || bytes.len() > 15 * 1024 * 1024 {
        return Err(invalid("Speech audio is empty or exceeds 15 MiB"));
    }
    let mime = if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WAVE") {
        "audio/wav"
    } else if bytes.starts_with(b"ID3")
        || (bytes.len() > 1 && bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0)
    {
        "audio/mpeg"
    } else {
        return Err(invalid("Speech provider returned invalid WAV or MP3 audio"));
    };
    Ok((bytes, mime))
}

pub fn image_payload(
    c: &MediaProviderConfig,
    prompt: &str,
    size: &str,
    quality: Option<&str>,
) -> Result<Value, MediaError> {
    let (width, height) = size
        .split_once('x')
        .and_then(|(w, h)| Some((w.parse::<u32>().ok()?, h.parse::<u32>().ok()?)))
        .ok_or_else(|| MediaError::new("invalid_request", "Invalid image size"))?;
    let ratio = match size {
        "1536x1024" => "3:2",
        "1024x1536" => "2:3",
        "1792x1024" => "16:9",
        "1024x1792" => "9:16",
        _ => "1:1",
    };
    let mut body = match c.provider.as_str() {
        "minimax" => return super::minimax::image_payload(&c.model, prompt, size),
        "gemini" => {
            json!({"contents":[{"role":"user","parts":[{"text":prompt}]}],"generationConfig":{"responseModalities":["TEXT","IMAGE"],"imageConfig":{"aspectRatio":ratio}}})
        }
        "dashscope" => {
            json!({"model":c.model,"input":{"messages":[{"role":"user","content":[{"text":prompt}]}]},"parameters":{"size":size.replace('x',"*"),"n":1,"prompt_extend":false,"watermark":true}})
        }
        "siliconflow" => json!({"model":c.model,"prompt":prompt,"image_size":size}),
        "together" => {
            if c.model.contains("schnell") || c.model.contains("kontext") {
                json!({"model":c.model,"prompt":prompt,"aspect_ratio":ratio,"n":1,"response_format":"b64_json"})
            } else {
                json!({"model":c.model,"prompt":prompt,"width":width,"height":height,"n":1,"response_format":"b64_json"})
            }
        }
        "volcengine" => {
            if width != height {
                return Err(MediaError::new("invalid_request", "Seedream requires a square 2048×2048 image within Textus's image safety limits"));
            }
            json!({"model":c.model,"prompt":prompt,"size":"2048x2048","response_format":"b64_json","sequential_image_generation":"disabled","watermark":true})
        }
        _ => {
            let mut body = json!({"model":c.model,"prompt":prompt,"size":size,"n":1});
            if c.provider == "openai-compatible" || !c.model.starts_with("gpt-image") {
                body["response_format"] = json!("b64_json");
            }
            body
        }
    };
    if let Some(q) =
        quality.filter(|_| matches!(c.provider.as_str(), "openai" | "openai-compatible"))
    {
        if !matches!(q, "auto" | "low" | "medium" | "high" | "standard" | "hd") {
            return Err(MediaError::new(
                "invalid_request",
                "Unsupported image quality",
            ));
        }
        body["quality"] = json!(q);
    }
    Ok(body)
}
pub async fn image_bytes(response: &Value, c: &MediaProviderConfig) -> Result<Vec<u8>, MediaError> {
    let url = match c.provider.as_str() {
        "minimax" => Some(super::minimax::image_url(response)?),
        "gemini" => return inline_data(response, "image/").map(|(bytes, _)| bytes),
        "dashscope" => Some(
            response
                .pointer("/output/choices/0/message/content/0/image")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("Qwen returned no generated image"))?,
        ),
        "siliconflow" => Some(
            response
                .get("images")
                .and_then(Value::as_array)
                .filter(|a| a.len() == 1)
                .and_then(|a| a[0].get("url"))
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("Expected exactly one SiliconFlow image"))?,
        ),
        _ => {
            let first = response
                .get("data")
                .and_then(Value::as_array)
                .filter(|a| a.len() == 1)
                .and_then(|a| a.first())
                .ok_or_else(|| invalid("Expected exactly one generated image"))?;
            if let Some(encoded) = first.get("b64_json").and_then(Value::as_str) {
                return STANDARD
                    .decode(encoded)
                    .map_err(|_| invalid("Provider returned invalid image base64"));
            }
            Some(
                first
                    .get("url")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("Provider returned neither image data nor a URL"))?,
            )
        }
    };
    super::image::download_media(url.unwrap(), super::image::MAX_IMAGE_BYTES).await
}

#[cfg(test)]
#[path = "protocols_tests.rs"]
mod tests;
