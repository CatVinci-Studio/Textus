use super::*;
use serde_json::json;
fn config(provider: &str) -> MediaProviderConfig {
    serde_json::from_value(json!({"provider":provider,"endpoint":"https://example.com/v1","model":"test-model","voice":"Kore","language":"en"})).unwrap()
}
async fn fixture_response(body: Vec<u8>, content_type: &str) -> reqwest::Response {
    use std::io::{Read, Write};
    let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = server.local_addr().unwrap();
    let content_type = content_type.to_owned();
    std::thread::spawn(move || {
        let (mut socket, _) = server.accept().unwrap();
        let mut request = [0; 4096];
        assert!(socket.read(&mut request).unwrap() > 0);
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",content_type,body.len()).unwrap();
        socket.write_all(&body).unwrap();
    });
    reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap()
        .get(format!("http://{address}"))
        .send()
        .await
        .unwrap()
}
#[tokio::test]
async fn synthesis_decodes_json_envelopes_and_identifies_real_audio_mime() {
    let c = config("gemini");
    let envelope = json!({"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"audio/L16;codec=pcm;rate=24000","data":STANDARD.encode([1,2,3,4])}}]}}]});
    let (bytes, mime) = speech_audio(
        fixture_response(envelope.to_string().into_bytes(), "application/json").await,
        &c,
    )
    .await
    .unwrap();
    assert_eq!(mime, "audio/wav");
    assert_eq!(&bytes[44..], [1, 2, 3, 4]);
    let envelope = json!({"base_resp":{"status_code":0},"data":{"audio":"494433010203"}});
    let (bytes, mime) = speech_audio(
        fixture_response(envelope.to_string().into_bytes(), "application/json").await,
        &config("minimax"),
    )
    .await
    .unwrap();
    assert_eq!(mime, "audio/mpeg");
    assert_eq!(bytes, b"ID3\x01\x02\x03");
    for envelope in [
        json!({"base_resp":{"status_code":1004},"data":{"audio":"494433"}}),
        json!({"base_resp":{"status_code":0},"data":{"audio":"xyz"}}),
    ] {
        assert!(speech_audio(
            fixture_response(envelope.to_string().into_bytes(), "application/json").await,
            &config("minimax")
        )
        .await
        .is_err());
    }
    let wav = pcm_wav(vec![0; 8], 16000).unwrap();
    let (_, mime) = speech_audio(fixture_response(wav, "audio/wav").await, &config("groq"))
        .await
        .unwrap();
    assert_eq!(mime, "audio/wav");
    assert!(speech_audio(
        fixture_response(b"{\"secret\":true}".to_vec(), "application/json").await,
        &config("openai")
    )
    .await
    .is_err());
    assert!(speech_audio(
        fixture_response(b"not audio".to_vec(), "audio/mpeg").await,
        &config("deepgram")
    )
    .await
    .is_err());
}
#[test]
fn native_asr_contracts_validate_format_language_and_nesting() {
    let client = reqwest::Client::new();
    let c = config("dashscope");
    let r = transcription_request(
        client.post("https://example.com"),
        &c,
        vec![1, 2],
        "audio/wav",
        "wav",
        Some("zh"),
    )
    .unwrap()
    .build()
    .unwrap();
    let body: Value = serde_json::from_slice(r.body().unwrap().as_bytes().unwrap()).unwrap();
    assert_eq!(
        body["input"]["messages"][0]["content"][0]["audio"],
        "data:audio/wav;base64,AQI="
    );
    assert_eq!(body["parameters"]["asr_options"]["language"], "zh");
    assert_eq!(
        transcript(
            &json!({"output":{"choices":[{"message":{"content":[{"text":"你好"}]}}]}}),
            "dashscope"
        )
        .unwrap(),
        "你好"
    );
    let c = config("deepgram");
    let r = transcription_request(
        client.post("https://example.com"),
        &c,
        vec![1, 2],
        "audio/wav",
        "wav",
        None,
    )
    .unwrap()
    .build()
    .unwrap();
    assert!(r.url().as_str().contains("model=test-model"));
    assert!(r.url().as_str().contains("detect_language=true"));
    assert_eq!(r.body().unwrap().as_bytes().unwrap(), [1, 2]);
    let c = config("azure-speech");
    let r = transcription_request(
        client.post("https://example.com"),
        &c,
        pcm_wav(vec![0; 8], 16000).unwrap(),
        "audio/wav",
        "wav",
        Some("zh"),
    )
    .unwrap()
    .build()
    .unwrap();
    assert!(r.url().as_str().contains("language=zh-CN"));
    assert!(transcription_request(
        client.post("https://example.com"),
        &c,
        pcm_wav(vec![0; 8], 24000).unwrap(),
        "audio/wav",
        "wav",
        None
    )
    .is_err());
    assert!(transcription_request(
        client.post("https://example.com"),
        &c,
        vec![0; 8],
        "audio/webm",
        "webm",
        None
    )
    .is_err());
    assert!(transcription_request(
        client.post("https://example.com"),
        &config("deepgram"),
        vec![1],
        "audio/wav",
        "wav",
        Some("---")
    )
    .is_err());
}
#[test]
fn image_gateways_use_their_documented_parameters() {
    let body = image_payload(&config("siliconflow"), "tree", "1024x1024", None).unwrap();
    assert_eq!(
        body,
        json!({"model":"test-model","prompt":"tree","image_size":"1024x1024"})
    );
    let body = image_payload(&config("together"), "tree", "1536x1024", None).unwrap();
    assert_eq!(body["width"], 1536);
    assert_eq!(body["height"], 1024);
    assert!(body.get("size").is_none());
    let body = image_payload(&config("dashscope"), "tree", "1024x1536", None).unwrap();
    assert_eq!(body["parameters"]["size"], "1024*1536");
    assert_eq!(body["input"]["messages"][0]["content"][0]["text"], "tree");
    let body = image_payload(&config("gemini"), "tree", "1536x1024", None).unwrap();
    assert_eq!(
        body["generationConfig"]["imageConfig"]["aspectRatio"],
        "3:2"
    );
    let body = image_payload(&config("volcengine"), "tree", "1024x1024", None).unwrap();
    assert_eq!(body["sequential_image_generation"], "disabled");
    assert_eq!(body["size"], "2048x2048");
    assert!(image_payload(&config("volcengine"), "tree", "1536x1024", None).is_err());
    assert!(body.get("n").is_none());
    assert_eq!(
        secure_result_url("http://result.oss-cn-beijing.aliyuncs.com/audio.wav?sign=x").unwrap(),
        "https://result.oss-cn-beijing.aliyuncs.com/audio.wav?sign=x"
    );
    assert!(secure_result_url("http://127.0.0.1/audio.wav")
        .unwrap()
        .starts_with("http:"));
}
#[test]
fn settings_reject_unsupported_capabilities_and_language_shapes() {
    for (p, c) in [
        ("deepgram", "image"),
        ("gemini", "stt"),
        ("system", "tts"),
        ("volcengine", "stt"),
    ] {
        assert!(provider::validate_capability(&config(p), c).is_err());
    }
    for l in ["---", "en-", "en_Us", "en?key=x"] {
        assert!(!provider::valid_language(l));
    }
    for l in ["", "auto", "en", "zh-CN", "en-US", "cmn-CN"] {
        assert!(provider::valid_language(l));
    }
    let c: MediaProviderConfig =
        serde_json::from_value(json!({"provider":"system","endpoint":"","model":""})).unwrap();
    assert!(provider::validate_capability(&c, "stt").is_ok());
    assert!(route(&c, "stt", "audio/transcriptions").is_err());
}

#[test]
fn capabilities_and_auth_do_not_mislabel_native_protocols() {
    assert!(supports("deepgram", "stt"));
    for (p, c) in [
        ("deepgram", "image"),
        ("gemini", "stt"),
        ("system", "tts"),
        ("volcengine", "tts"),
    ] {
        assert!(!supports(p, c));
    }
    for (p, c, path, header, value) in [
        (
            "elevenlabs",
            "stt",
            "speech-to-text",
            "xi-api-key",
            "secret",
        ),
        ("deepgram", "stt", "listen", "authorization", "Token secret"),
        (
            "gemini",
            "tts",
            "models/test-model:generateContent",
            "x-goog-api-key",
            "secret",
        ),
        ("minimax", "tts", "t2a_v2", "authorization", "Bearer secret"),
        (
            "azure-speech",
            "tts",
            "cognitiveservices/v1",
            "ocp-apim-subscription-key",
            "secret",
        ),
    ] {
        assert_eq!(route(&config(p), c, "wrong").unwrap(), path);
        let r = authorize(
            reqwest::Client::new().post("https://example.com"),
            p,
            "secret",
        )
        .build()
        .unwrap();
        assert_eq!(r.headers()[header], value);
        assert_eq!(r.headers().len(), 1);
    }
}
#[test]
fn normalizes_native_results_and_rejects_invalid_audio() {
    assert_eq!(
        transcript(
            &json!({"results":{"channels":[{"alternatives":[{"transcript":"hello"}]}]}}),
            "deepgram"
        )
        .unwrap(),
        "hello"
    );
    assert_eq!(
        transcript(
            &json!({"RecognitionStatus":"Success","DisplayText":"hello"}),
            "azure-speech"
        )
        .unwrap(),
        "hello"
    );
    assert!(transcript(
        &json!({"RecognitionStatus":"Error","DisplayText":"private"}),
        "azure-speech"
    )
    .is_err());
    let wav = pcm_wav(vec![1, 2, 3, 4], 24000).unwrap();
    assert_eq!(&wav[..4], b"RIFF");
    assert_eq!(&wav[44..], [1, 2, 3, 4]);
    assert!(pcm_wav(vec![1], 24000).is_err());
    assert_eq!(decode_hex("494433").unwrap(), b"ID3");
    assert!(decode_hex("zz").is_err());
}
#[tokio::test]
async fn native_synthesis_http_contracts() {
    use std::io::{Read, Write};
    for p in [
        "minimax",
        "elevenlabs",
        "deepgram",
        "gemini",
        "dashscope",
        "azure-speech",
    ] {
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = server.local_addr().unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut socket, _) = server.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .unwrap();
            let mut raw = Vec::new();
            let mut buffer = [0; 4096];
            loop {
                let n = socket.read(&mut buffer).unwrap();
                assert!(n > 0);
                raw.extend_from_slice(&buffer[..n]);
                if let Some(pos) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&raw[..pos]).to_ascii_lowercase();
                    let len = headers
                        .lines()
                        .find_map(|l| l.strip_prefix("content-length: "))
                        .unwrap()
                        .parse::<usize>()
                        .unwrap();
                    if raw.len() >= pos + 4 + len {
                        break;
                    }
                }
            }
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .unwrap();
            sender.send(String::from_utf8(raw).unwrap()).unwrap();
        });
        let c = config(p);
        let r = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .post(format!(
                "http://{address}/{}",
                route(&c, "tts", "").unwrap()
            ));
        synthesis_request(
            authorize(r, p, "fixture-key"),
            &c,
            "Read <this> & only this",
            "Kore",
        )
        .unwrap()
        .send()
        .await
        .unwrap();
        let wire = receiver.recv().unwrap();
        assert!(wire.contains("fixture-key"));
        if p == "azure-speech" {
            assert!(wire.contains("application/ssml+xml"));
            assert!(wire.contains("Read &lt;this&gt; &amp; only this"));
        } else {
            let body: Value = serde_json::from_str(wire.split("\r\n\r\n").nth(1).unwrap()).unwrap();
            match p {
                "minimax" => {
                    assert_eq!(body["voice_setting"]["voice_id"], "Kore");
                    assert_eq!(body["output_format"], "hex");
                }
                "elevenlabs" => assert_eq!(body["model_id"], "test-model"),
                "deepgram" => assert_eq!(body, json!({"text":"Read <this> & only this"})),
                "gemini" => assert_eq!(
                    body["generationConfig"]["responseModalities"],
                    json!(["AUDIO"])
                ),
                "dashscope" => assert_eq!(body["input"]["voice"], "Kore"),
                _ => unreachable!(),
            }
        }
    }
}

#[tokio::test]
async fn native_transcription_http_contracts() {
    use std::io::{Read, Write};
    for p in [
        "minimax",
        "elevenlabs",
        "deepgram",
        "dashscope",
        "azure-speech",
        "openai",
    ] {
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = server.local_addr().unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut socket, _) = server.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .unwrap();
            let mut raw = Vec::new();
            let mut buffer = [0; 4096];
            loop {
                let n = socket.read(&mut buffer).unwrap();
                assert!(n > 0);
                raw.extend_from_slice(&buffer[..n]);
                if let Some(pos) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&raw[..pos]).to_ascii_lowercase();
                    let len = headers
                        .lines()
                        .find_map(|l| l.strip_prefix("content-length: "))
                        .unwrap()
                        .parse::<usize>()
                        .unwrap();
                    if raw.len() >= pos + 4 + len {
                        break;
                    }
                }
            }
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
                .unwrap();
            sender
                .send(String::from_utf8_lossy(&raw).to_string())
                .unwrap();
        });
        let mut c = config(p);
        if p == "minimax" {
            c.model = "asr-1.0".into();
        }
        let request = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .post(format!(
                "http://{address}/{}",
                route(&c, "stt", "audio/transcriptions").unwrap()
            ));
        transcription_request(
            authorize(request, p, "fixture-key"),
            &c,
            pcm_wav(vec![0; 8], 16000).unwrap(),
            "audio/wav",
            "wav",
            Some(match p {
                "openai" | "deepgram" => "zh-CN",
                "elevenlabs" | "azure-speech" => "en-US",
                _ => "ja",
            }),
        )
        .unwrap()
        .send()
        .await
        .unwrap();
        let wire = receiver.recv().unwrap();
        match p {
            "openai" => {
                assert!(wire.contains("name=\"language\"\r\n\r\nzh\r\n"));
                assert!(!wire.contains("zh-CN"));
            }
            "minimax" => {
                assert!(wire.contains("language: ja"));
                assert!(wire.contains("name=\"stream\"\r\n\r\nfalse"));
                assert!(wire.contains("name=\"model\"\r\n\r\nasr-1.0"));
            }
            "elevenlabs" => {
                assert!(wire.contains("xi-api-key: fixture-key"));
                assert!(wire.contains("name=\"model_id\"\r\n\r\ntest-model"));
                assert!(wire.contains("name=\"language_code\"\r\n\r\nen"));
                assert!(!wire.contains("name=\"response_format\""));
            }
            "deepgram" => {
                assert!(wire.contains("authorization: Token fixture-key"));
                assert!(wire.starts_with(
                    "POST /listen?model=test-model&smart_format=true&language=zh-CN "
                ));
                assert!(wire.contains("RIFF"));
            }
            "dashscope" => {
                assert!(wire.starts_with("POST /services/aigc/multimodal-generation/generation "));
                assert!(wire.contains("data:audio/wav;base64,"));
                assert!(wire.contains("\"asr_options\":{\"enable_itn\":false,\"language\":\"ja\"}"));
            }
            "azure-speech" => {
                assert!(wire.contains("ocp-apim-subscription-key: fixture-key"));
                assert!(wire.contains("audio/wav; codecs=audio/pcm; samplerate=16000"));
                assert!(wire.contains("RIFF"));
            }
            _ => unreachable!(),
        }
    }
}
