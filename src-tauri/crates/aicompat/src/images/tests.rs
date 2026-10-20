//! Each service's request and reply against a local HTTP fixture: what is
//! sent (path, auth, body) and how each kind of answer is read. No request
//! leaves the machine.

use super::sniff::tests::png;
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;

/// A request as the fixture received it.
struct Seen {
    line: String,
    headers: String,
    body: Value,
}

/// Serves `replies` (status, content type, body) to the requests that come
/// in, one each, in order; the requests come back over the channel.
fn serve(replies: Vec<(u16, &'static str, Vec<u8>)>) -> (String, mpsc::Receiver<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for (status, kind, reply) in replies {
            let (mut socket, _) = listener.accept().unwrap();
            let mut raw = Vec::new();
            let mut buf = [0u8; 65536];
            // Headers, then as much body as Content-Length says.
            let (head_end, length) = loop {
                let n = socket.read(&mut buf).unwrap();
                raw.extend_from_slice(&buf[..n]);
                if let Some(at) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&raw[..at]).to_lowercase();
                    let length = head
                        .lines()
                        .find_map(|l| l.strip_prefix("content-length:"))
                        .map(|v| v.trim().parse::<usize>().unwrap())
                        .unwrap_or(0);
                    break (at + 4, length);
                }
            };
            while raw.len() < head_end + length {
                let n = socket.read(&mut buf).unwrap();
                raw.extend_from_slice(&buf[..n]);
            }
            let head = String::from_utf8_lossy(&raw[..head_end]).to_string();
            let (line, headers) = head.split_once("\r\n").unwrap();
            let body = serde_json::from_slice(&raw[head_end..]).unwrap_or(Value::Null);
            write!(
                socket,
                "HTTP/1.1 {status} X\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                reply.len()
            )
            .unwrap();
            socket.write_all(&reply).unwrap();
            let _ = tx.send(Seen {
                line: line.to_string(),
                headers: headers.to_lowercase(),
                body,
            });
        }
    });
    (base, rx)
}

fn json_reply(status: u16, value: Value) -> (u16, &'static str, Vec<u8>) {
    (status, "application/json", value.to_string().into_bytes())
}

fn picture() -> Vec<u8> {
    png(4, 3)
}

fn b64() -> String {
    STANDARD.encode(picture())
}

fn run(
    api: ImageApi,
    base: &str,
    model: &str,
    aspect: Aspect,
) -> Result<GeneratedImage, ImageError> {
    tauri::async_runtime::block_on(generate(
        &ImageTarget {
            api,
            base_url: base,
            api_key: "sk-test",
            model,
        },
        "A lighthouse on a cliff at dusk",
        aspect,
    ))
}

#[test]
fn openai_asks_for_one_medium_jpeg_and_reads_the_base64() {
    let (base, seen) = serve(vec![json_reply(
        200,
        json!({"data": [{"b64_json": b64()}]}),
    )]);
    let image = run(ImageApi::OpenAi, &base, "gpt-image-2", Aspect::Wide).unwrap();
    assert_eq!((image.mime, image.width, image.height), ("image/png", 4, 3));
    let req = seen.recv().unwrap();
    assert_eq!(req.line, "POST /images/generations HTTP/1.1");
    assert!(req.headers.contains("authorization: bearer sk-test"));
    assert_eq!(req.body["size"], "1536x1024");
    assert_eq!(req.body["quality"], "medium");
    assert_eq!(req.body["n"], 1);
    // GPT image models refuse it.
    assert!(req.body.get("response_format").is_none());
}

#[test]
fn openai_moderation_is_a_refusal_with_its_reason() {
    let (base, _seen) = serve(vec![json_reply(
        400,
        json!({"error": {"code": "moderation_blocked", "type": "image_generation_user_error",
            "message": "Your request was rejected by the safety system."}}),
    )]);
    let err = run(ImageApi::OpenAi, &base, "gpt-image-2", Aspect::Square).unwrap_err();
    assert_eq!(
        err,
        ImageError::Refused("Your request was rejected by the safety system.".into())
    );
}

#[test]
fn a_compatible_server_is_asked_for_base64_and_may_answer_with_a_link() {
    let (pictures, _) = serve(vec![(200, "image/png", picture())]);
    let (base, seen) = serve(vec![json_reply(
        200,
        json!({"data": [{"url": format!("{pictures}/p.png")}]}),
    )]);
    let image = run(ImageApi::Compatible, &base, "flux-dev", Aspect::Portrait).unwrap();
    assert_eq!(image.height, 3);
    let req = seen.recv().unwrap();
    assert_eq!(req.body["response_format"], "b64_json");
    assert_eq!(req.body["size"], "1024x1536");
    assert!(req.body.get("quality").is_none());
}

#[test]
fn a_link_is_downloaded_and_checked_to_be_a_picture() {
    let (pictures, _) = serve(vec![(200, "image/png", picture())]);
    let (base, seen) = serve(vec![json_reply(
        200,
        json!({"data": [{"url": format!("{pictures}/a.png")}]}),
    )]);
    let image = run(ImageApi::Zhipu, &base, "cogview-4-250304", Aspect::Tall).unwrap();
    assert_eq!(image.ext, "png");
    let req = seen.recv().unwrap();
    assert_eq!(req.body["size"], "768x1344");
    assert!(req.body.get("quality").is_none());
}

#[test]
fn a_page_served_as_a_picture_is_turned_down() {
    let (pages, _) = serve(vec![(200, "image/png", b"<html>expired</html>".to_vec())]);
    let (base, _seen) = serve(vec![json_reply(
        200,
        json!({"data": [{"url": format!("{pages}/a.png")}]}),
    )]);
    let err = run(ImageApi::Zhipu, &base, "glm-image", Aspect::Square).unwrap_err();
    assert!(
        err.to_string().contains("isn't a PNG, JPEG or WebP"),
        "{err}"
    );
}

#[test]
fn a_link_that_isnt_https_is_never_opened() {
    let (base, _seen) = serve(vec![json_reply(
        200,
        json!({"data": [{"url": "http://cdn.example.com/a.png"}]}),
    )]);
    let err = run(ImageApi::Zhipu, &base, "glm-image", Aspect::Square).unwrap_err();
    assert!(err.to_string().contains("isn't an HTTPS address"), "{err}");
}

#[test]
fn zhipu_glm_image_asks_for_hd_and_1301_is_a_refusal() {
    let (base, seen) = serve(vec![json_reply(
        400,
        json!({"error": {"code": "1301", "message": "系统检测到输入或生成内容可能包含不安全或敏感内容"}}),
    )]);
    let err = run(ImageApi::Zhipu, &base, "glm-image", Aspect::Landscape).unwrap_err();
    assert!(
        matches!(&err, ImageError::Refused(why) if why.contains("敏感")),
        "{err:?}"
    );
    let req = seen.recv().unwrap();
    assert_eq!(req.body["quality"], "hd");
    assert_eq!(req.body["size"], "1472x1088");
}

#[test]
fn zhipu_arrears_is_a_quota_error() {
    let (base, _seen) = serve(vec![json_reply(
        429,
        json!({"error": {"code": "1113", "message": "您的账户已欠费"}}),
    )]);
    let err = run(ImageApi::Zhipu, &base, "glm-image", Aspect::Square).unwrap_err();
    assert_eq!(err, ImageError::Quota("您的账户已欠费".into()));
}

#[test]
fn gemini_sends_the_key_header_and_reads_the_inline_picture() {
    let (base, seen) = serve(vec![json_reply(
        200,
        json!({"candidates": [{"content": {"parts": [
            {"text": "Here it is."},
            {"inlineData": {"mimeType": "image/png", "data": b64()}},
        ]}}]}),
    )]);
    let image = run(
        ImageApi::Gemini,
        &base,
        "gemini-nano-banana-2.1",
        Aspect::Portrait,
    )
    .unwrap();
    assert_eq!(image.width, 4);
    let req = seen.recv().unwrap();
    assert_eq!(
        req.line,
        "POST /models/gemini-nano-banana-2.1:generateContent HTTP/1.1"
    );
    assert!(req.headers.contains("x-goog-api-key: sk-test"));
    assert!(!req.headers.contains("authorization"));
    assert_eq!(
        req.body["generationConfig"]["imageConfig"],
        json!({"aspectRatio": "3:4", "imageSize": "1K"})
    );
}

#[test]
fn gemini_blocks_are_refusals_whether_of_the_prompt_or_the_picture() {
    let (base, _seen) = serve(vec![
        json_reply(
            200,
            json!({"promptFeedback": {"blockReason": "PROHIBITED_CONTENT"}}),
        ),
        json_reply(
            200,
            json!({"candidates": [{"finishReason": "IMAGE_SAFETY",
                "finishMessage": "Unable to show the generated image.", "content": {"parts": []}}]}),
        ),
        json_reply(
            200,
            json!({"candidates": [{"finishReason": "STOP",
            "content": {"parts": [{"text": "I can only describe it."}]}}]}),
        ),
    ]);
    let model = "gemini-3.1-flash-lite-image";
    assert_eq!(
        run(ImageApi::Gemini, &base, model, Aspect::Square).unwrap_err(),
        ImageError::Refused("PROHIBITED_CONTENT".into())
    );
    assert_eq!(
        run(ImageApi::Gemini, &base, model, Aspect::Square).unwrap_err(),
        ImageError::Refused("Unable to show the generated image.".into())
    );
    assert_eq!(
        run(ImageApi::Gemini, &base, model, Aspect::Square).unwrap_err(),
        ImageError::Failed("The model sent no picture: I can only describe it.".into())
    );
}

#[test]
fn seedream_asks_for_base64_at_its_smallest_size_and_reads_its_codes() {
    let (base, seen) = serve(vec![
        json_reply(
            200,
            json!({"data": [{"b64_json": b64(), "size": "1280x720"}]}),
        ),
        json_reply(
            400,
            json!({"error": {"code": "OutputImageSensitiveContentDetected",
                "message": "The generated image may contain sensitive content.", "type": "BadRequest"}}),
        ),
        json_reply(
            403,
            json!({"error": {"code": "AccountOverdueError", "message": "overdue"}}),
        ),
    ]);
    let model = "doubao-seedream-5-0-flash-260915";
    run(ImageApi::Seedream, &base, model, Aspect::Wide).unwrap();
    let req = seen.recv().unwrap();
    assert_eq!(req.body["size"], "1280x720");
    assert_eq!(req.body["response_format"], "b64_json");
    // Ark's own default (its mark on the picture) is kept.
    assert!(req.body.get("watermark").is_none());
    assert_eq!(
        run(ImageApi::Seedream, &base, model, Aspect::Square).unwrap_err(),
        ImageError::Refused("The generated image may contain sensitive content.".into())
    );
    assert_eq!(
        run(ImageApi::Seedream, &base, model, Aspect::Square).unwrap_err(),
        ImageError::Quota("overdue".into())
    );
}

#[test]
fn dashscope_uses_the_synchronous_route_and_downloads_the_link() {
    let (pictures, _) = serve(vec![(200, "image/png", picture())]);
    let (base, seen) = serve(vec![
        json_reply(
            200,
            json!({"output": {"choices": [{"message": {"role": "assistant",
                "content": [{"image": format!("{pictures}/x.png")}]}}]}}),
        ),
        json_reply(
            400,
            json!({"request_id": "r", "code": "DataInspectionFailed",
                "message": "Input data may contain inappropriate content."}),
        ),
    ]);
    run(
        ImageApi::DashScope,
        &base,
        "qwen-image-3.0",
        Aspect::Landscape,
    )
    .unwrap();
    let req = seen.recv().unwrap();
    assert_eq!(
        req.line,
        "POST /services/aigc/multimodal-generation/generation HTTP/1.1"
    );
    assert_eq!(req.body["parameters"]["size"], "1472*1104");
    assert_eq!(req.body["parameters"]["prompt_extend"], false);
    assert_eq!(
        req.body["input"]["messages"][0]["content"][0]["text"],
        "A lighthouse on a cliff at dusk"
    );
    assert_eq!(
        run(ImageApi::DashScope, &base, "qwen-image-3.0", Aspect::Square).unwrap_err(),
        ImageError::Refused("Input data may contain inappropriate content.".into())
    );
}

#[test]
fn siliconflow_sends_image_size_and_reads_images() {
    let (pictures, _) = serve(vec![(200, "image/png", picture())]);
    let (base, seen) = serve(vec![json_reply(
        200,
        json!({"images": [{"url": format!("{pictures}/k.png")}], "seed": 1}),
    )]);
    run(
        ImageApi::SiliconFlow,
        &base,
        "Kwai-Kolors/Kolors",
        Aspect::Wide,
    )
    .unwrap();
    let req = seen.recv().unwrap();
    // Kolors makes no wide picture: the square one.
    assert_eq!(req.body["image_size"], "1024x1024");
    assert!(req.body.get("size").is_none());
}

#[test]
fn an_endpoint_must_be_https_unless_it_is_this_computer() {
    let err = run(
        ImageApi::Compatible,
        "http://images.example.com/v1",
        "m",
        Aspect::Square,
    )
    .unwrap_err();
    assert!(err.to_string().contains("https://"), "{err}");
    assert!(check_endpoint("http://localhost:8080/v1").is_ok());
    assert!(check_endpoint("http://127.0.0.1:8080/v1").is_ok());
    assert!(check_endpoint("https://api.example.com/v1").is_ok());
}

#[test]
fn a_non_json_error_page_is_reported_shortly() {
    let page = "<html>".to_string() + &"x".repeat(1000) + "</html>";
    let (base, _seen) = serve(vec![(502, "text/html", page.into_bytes())]);
    let err = run(ImageApi::OpenAi, &base, "gpt-image-2", Aspect::Square).unwrap_err();
    let ImageError::Failed(message) = err else {
        panic!("a bad gateway is an ordinary failure");
    };
    assert!(
        message.starts_with("Image request failed (502"),
        "{message}"
    );
    assert!(message.chars().count() < 400);
}

#[test]
fn every_aspect_has_its_ratio() {
    for ratio in Aspect::ALL {
        assert_eq!(Aspect::parse(ratio).unwrap().ratio(), ratio);
    }
    assert_eq!(Aspect::parse("2:1"), None);
}
