use super::*;
use std::io::{Read, Write};

#[test]
fn finds_nested_response_url() {
    let value = serde_json::json!({"data": {"image": {"url": "https://img.test/a.png"}}});
    assert_eq!(
        response_url(&value, "data.image.url").as_deref(),
        Some("https://img.test/a.png")
    );
}

#[test]
fn a_number_in_the_url_field_indexes_an_array() {
    let value = serde_json::json!({"success": true, "result": ["https://img.test/a.png"]});
    assert_eq!(
        response_url(&value, "result.0").as_deref(),
        Some("https://img.test/a.png")
    );
}

#[test]
fn accepts_only_web_urls() {
    assert!(valid_public_url("https://img.test/a.png"));
    assert!(!valid_public_url("file:///tmp/a.png"));
    assert!(!valid_public_url("not a url"));
}

#[test]
fn picgo_is_reached_only_on_this_computer() {
    let picgo = ImageHost::Picgo.preset();
    for ok in [
        "http://127.0.0.1:36677/upload",
        "http://localhost:36677/upload",
        "http://[::1]:36677/upload",
    ] {
        assert!(upload_url(&picgo, ok).is_ok(), "{ok}");
    }
    for refused in [
        "http://192.168.1.2:36677/upload",
        "https://picgo.example.com/upload",
        "http://127.0.0.1.example.com/upload",
    ] {
        assert!(upload_url(&picgo, refused).is_err(), "{refused}");
    }
}

#[test]
fn hosted_services_ignore_the_endpoint_setting() {
    let url = |host: ImageHost| upload_url(&host.preset(), "http://elsewhere.test/").unwrap();
    assert_eq!(url(ImageHost::Smms).as_str(), "https://sm.ms/api/v2/upload");
    assert_eq!(
        url(ImageHost::Imgur).as_str(),
        "https://api.imgur.com/3/image"
    );
    assert_eq!(url(ImageHost::Custom).as_str(), "http://elsewhere.test/");
    assert!(upload_url(&ImageHost::Custom.preset(), "ftp://x.test/").is_err());
}

#[test]
fn every_host_keeps_its_own_token() {
    let ids = [
        ImageHost::Picgo,
        ImageHost::Smms,
        ImageHost::Imgur,
        ImageHost::Custom,
    ]
    .map(ImageHost::credential_id);
    assert_eq!(ids[3], "__image_host");
    assert!(ids.iter().enumerate().all(|(i, id)| !ids[..i].contains(id)));
}

/// Answers one request with `status` and `body` on a local port, and
/// hands back the raw request it got.
fn serve_once(status: &str, body: &str) -> (String, std::thread::JoinHandle<String>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/upload", listener.local_addr().unwrap());
    let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            let n = stream.read(&mut buf).unwrap();
            request.extend_from_slice(&buf[..n]);
            let text = String::from_utf8_lossy(&request);
            if let Some(end) = text.find("\r\n\r\n") {
                let length = text[..end]
                    .lines()
                    .find_map(|line| {
                        let (key, value) = line.split_once(':')?;
                        key.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())?
                    })
                    .unwrap_or(0);
                if request.len() >= end + 4 + length {
                    break;
                }
            }
            if n == 0 {
                break;
            }
        }
        stream.write_all(response.as_bytes()).unwrap();
        String::from_utf8_lossy(&request).into_owned()
    });
    (url, handle)
}

fn png(path: Option<&str>) -> Image {
    Image {
        bytes: b"PNGDATA".to_vec(),
        filename: "shot.png".to_string(),
        mime: "image/png".to_string(),
        path: path.map(Into::into),
    }
}

async fn upload(
    host: ImageHost,
    token: Option<&str>,
    url_field: &str,
    image: Image,
    status: &str,
    answer: &str,
) -> (Result<String, String>, String) {
    let (url, server) = serve_once(status, answer);
    let result = send(
        &host.preset(),
        reqwest::Url::parse(&url).unwrap(),
        token.map(Into::into),
        url_field,
        image,
    )
    .await;
    (result, server.join().unwrap())
}

#[tokio::test]
async fn picgo_gets_the_file_path_and_piclist_its_key() {
    let (src, request) = upload(
        ImageHost::Picgo,
        Some("secret"),
        "",
        png(Some("/tmp/textus-upload-1/shot.png")),
        "200 OK",
        r#"{"success":true,"result":["https://cdn.test/shot.png"]}"#,
    )
    .await;
    assert_eq!(src.unwrap(), "https://cdn.test/shot.png");
    assert!(request.starts_with("POST /upload?key=secret "), "{request}");
    assert!(request.ends_with(r#"{"list":["/tmp/textus-upload-1/shot.png"]}"#));
}

#[tokio::test]
async fn picgo_says_why_an_upload_failed() {
    let (src, _) = upload(
        ImageHost::Picgo,
        None,
        "",
        png(Some("/tmp/shot.png")),
        "200 OK",
        r#"{"success":false,"message":"upload error"}"#,
    )
    .await;
    assert_eq!(src.unwrap_err(), "PicGo: upload error");
}

#[tokio::test]
async fn a_picgo_that_is_not_running_is_named() {
    // A port that was free a moment ago: nothing listens on it.
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let url = reqwest::Url::parse(&format!("http://127.0.0.1:{port}/upload")).unwrap();
    let err = send(
        &ImageHost::Picgo.preset(),
        url,
        None,
        "",
        png(Some("/tmp/a.png")),
    )
    .await
    .unwrap_err();
    assert_eq!(err, "PicGo isn't running, or its server is turned off");
}

#[tokio::test]
async fn smms_gets_smfile_and_a_plain_token() {
    let (src, request) = upload(
        ImageHost::Smms,
        Some("tok"),
        "",
        png(None),
        "200 OK",
        r#"{"success":true,"code":"success","data":{"url":"https://s2.loli.net/a.png"}}"#,
    )
    .await;
    assert_eq!(src.unwrap(), "https://s2.loli.net/a.png");
    assert!(request.contains("\r\nauthorization: tok\r\n"), "{request}");
    assert!(request.contains(r#"name="smfile"; filename="shot.png""#));
}

#[tokio::test]
async fn an_image_smms_already_has_comes_back_with_its_url() {
    let (src, _) = upload(
            ImageHost::Smms,
            Some("tok"),
            "",
            png(None),
            "200 OK",
            r#"{"success":false,"code":"image_repeated","message":"Image upload repeated limit, this image exists at: https://s2.loli.net/a.png","images":"https://s2.loli.net/a.png"}"#,
        )
        .await;
    assert_eq!(src.unwrap(), "https://s2.loli.net/a.png");
}

#[tokio::test]
async fn imgur_gets_image_and_a_client_id() {
    let (src, request) = upload(
        ImageHost::Imgur,
        Some("abc123"),
        "",
        png(None),
        "200 OK",
        r#"{"data":{"link":"https://i.imgur.com/a.png"},"success":true,"status":200}"#,
    )
    .await;
    assert_eq!(src.unwrap(), "https://i.imgur.com/a.png");
    assert!(request.contains("\r\nauthorization: Client-ID abc123\r\n"));
    assert!(request.contains(r#"name="image"; filename="shot.png""#));
}

#[tokio::test]
async fn custom_gets_file_a_bearer_token_and_its_url_field() {
    let (src, request) = upload(
        ImageHost::Custom,
        Some("tok"),
        "data.src",
        png(None),
        "200 OK",
        r#"{"data":{"src":"https://img.test/a.png"}}"#,
    )
    .await;
    assert_eq!(src.unwrap(), "https://img.test/a.png");
    assert!(request.contains("\r\nauthorization: Bearer tok\r\n"));
    assert!(request.contains(r#"name="file"; filename="shot.png""#));
}

#[tokio::test]
async fn an_error_status_is_reported_with_the_hosts_name() {
    let (src, _) = upload(
        ImageHost::Imgur,
        None,
        "",
        png(None),
        "403 Forbidden",
        r#"{"data":{"error":"Invalid client_id"}}"#,
    )
    .await;
    let err = src.unwrap_err();
    assert!(err.starts_with("Imgur returned 403 Forbidden"), "{err}");
}

#[test]
fn an_error_answer_is_cut_to_its_first_short_line() {
    assert_eq!(first_line("\n  Bad token \nmore detail"), "Bad token");
    let long = "x".repeat(MAX_ERROR_CHARS + 10);
    assert_eq!(first_line(&long).chars().count(), MAX_ERROR_CHARS + 1);
    assert!(first_line(&long).ends_with('…'));
}

#[tokio::test]
async fn an_html_error_page_is_not_pasted_into_the_message() {
    let page = format!(
        "<!DOCTYPE html>\n<html><body>{}</body></html>",
        "<p>Bad gateway</p>".repeat(500)
    );
    let (src, _) = upload(
        ImageHost::Custom,
        None,
        "url",
        png(None),
        "502 Bad Gateway",
        &page,
    )
    .await;
    assert_eq!(src.unwrap_err(), "The image host returned 502 Bad Gateway.");
}

#[test]
fn an_answer_is_html_by_its_type_or_its_first_character() {
    assert!(is_html(Some("text/html; charset=utf-8"), "Bad gateway"));
    assert!(is_html(Some("application/json"), "  <html>"));
    assert!(!is_html(
        Some("application/json"),
        r#"{"error":"bad token"}"#
    ));
    assert!(!is_html(None, "Bad token"));
}
