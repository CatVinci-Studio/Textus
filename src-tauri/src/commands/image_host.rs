//! Uploads pasted editor images to the image host chosen in Settings >
//! Images. Each host is a preset - where the request goes, how the image
//! and the token travel, and where the answer keeps the URL - so they all
//! share one upload path. "Custom" is the small contract a user's own
//! endpoint follows: multipart/form-data with a `file` part, an optional
//! bearer token, and either a plain URL response or JSON with the URL at a
//! configured dot-separated field path.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tauri::AppHandle;

use crate::atomic::TempDir;
use crate::auth::keys::load_provider_key;

const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;

/// Long enough for a 25 MB image on a slow uplink; a server that never
/// answers still releases the paste.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(120);

/// An answer is a URL or a little JSON; one far larger is neither.
const MAX_ANSWER_BYTES: usize = 1024 * 1024;

/// How much of an error answer goes into the message: an error page is
/// often a whole HTML document, and the editor shows the message on a line.
const MAX_ERROR_CHARS: usize = 160;

/// Mirrors `ImageHost` in src/settings/SettingsContext.tsx.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ImageHost {
    Picgo,
    Smms,
    Imgur,
    Custom,
}

/// How the image travels.
#[derive(Debug, PartialEq)]
enum Body {
    /// A multipart/form-data part with this name.
    Multipart(&'static str),
    /// `{"list": [path]}` naming a file on this machine - the PicGo server's
    /// documented upload, which PicList keeps.
    PathList,
}

/// How the token travels.
#[derive(Debug, PartialEq)]
enum Auth {
    Bearer,
    /// `Authorization: <token>`, as SM.MS takes it.
    Plain,
    /// `Authorization: Client-ID <token>`, Imgur's anonymous upload.
    ClientId,
    /// `?key=<token>`, PicList's server key.
    KeyQuery,
}

struct Preset {
    /// For error messages.
    name: &'static str,
    /// None: the endpoint from Settings.
    endpoint: Option<&'static str>,
    body: Body,
    auth: Auth,
    /// Where the JSON answer keeps the URL, tried in order; empty: the
    /// field from Settings.
    url_fields: &'static [&'static str],
    /// The host runs on this machine: a request anywhere else would send
    /// the file's path (and the key) off it.
    loopback_only: bool,
}

impl ImageHost {
    fn preset(self) -> Preset {
        match self {
            ImageHost::Picgo => Preset {
                name: "PicGo",
                endpoint: None,
                body: Body::PathList,
                auth: Auth::KeyQuery,
                url_fields: &["result.0"],
                loopback_only: true,
            },
            // An image SM.MS already has is answered with success: false
            // and its URL in `images`.
            ImageHost::Smms => Preset {
                name: "SM.MS",
                endpoint: Some("https://sm.ms/api/v2/upload"),
                body: Body::Multipart("smfile"),
                auth: Auth::Plain,
                url_fields: &["data.url", "images"],
                loopback_only: false,
            },
            ImageHost::Imgur => Preset {
                name: "Imgur",
                endpoint: Some("https://api.imgur.com/3/image"),
                body: Body::Multipart("image"),
                auth: Auth::ClientId,
                url_fields: &["data.link"],
                loopback_only: false,
            },
            ImageHost::Custom => Preset {
                name: "The image host",
                endpoint: None,
                body: Body::Multipart("file"),
                auth: Auth::Bearer,
                url_fields: &[],
                loopback_only: false,
            },
        }
    }

    /// Where its token is kept: the private credential store shared with
    /// the AI providers' keys, under an id never shown as a provider.
    /// Mirrors `imageHostAuth` in src/platform/ipc.ts.
    fn credential_id(self) -> &'static str {
        match self {
            ImageHost::Picgo => "__image_host_picgo",
            ImageHost::Smms => "__image_host_smms",
            ImageHost::Imgur => "__image_host_imgur",
            // Custom was the only host before the presets; its id stays.
            ImageHost::Custom => "__image_host",
        }
    }
}

#[derive(Serialize)]
pub struct UploadedImage {
    src: String,
}

/// The value at a dot-separated path; a number segment indexes an array
/// ("result.0").
fn response_url(value: &Value, path: &str) -> Option<String> {
    let mut current = value;
    for segment in path.split('.').filter(|part| !part.is_empty()) {
        current = match segment.parse::<usize>() {
            Ok(index) if current.is_array() => current.get(index)?,
            _ => current.get(segment)?,
        };
    }
    current.as_str().map(str::to_owned)
}

fn valid_public_url(value: &str) -> bool {
    reqwest::Url::parse(value)
        .map(|url| matches!(url.scheme(), "http" | "https"))
        .unwrap_or(false)
}

/// An error page rather than a message: its first line says nothing (a
/// doctype or an `<html>` tag), so the error gives the status alone.
fn is_html(content_type: Option<&str>, body: &str) -> bool {
    content_type.is_some_and(|value| value.trim_start().starts_with("text/html"))
        || body.trim_start().starts_with('<')
}

/// An error answer's first line, cut to MAX_ERROR_CHARS.
fn first_line(text: &str) -> String {
    let line = text.trim().lines().next().unwrap_or_default().trim_end();
    match line.char_indices().nth(MAX_ERROR_CHARS) {
        Some((end, _)) => format!("{}…", &line[..end]),
        None => line.to_string(),
    }
}

fn is_loopback(url: &reqwest::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    match host.trim_matches(['[', ']']).parse::<std::net::IpAddr>() {
        Ok(ip) => ip.is_loopback(),
        Err(_) => host.eq_ignore_ascii_case("localhost"),
    }
}

/// The URL the upload goes to: the preset's own, or the one from Settings.
fn upload_url(preset: &Preset, endpoint: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(preset.endpoint.unwrap_or(endpoint.trim()))
        .map_err(|_| "invalid upload URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("upload URL must use http or https".to_string());
    }
    if preset.loopback_only && !is_loopback(&url) {
        return Err(format!(
            "{} runs on this computer: its address must be 127.0.0.1 or localhost",
            preset.name
        ));
    }
    Ok(url)
}

/// The image as the request carries it: its bytes, and for a PathList host
/// the file they were written to.
struct Image {
    bytes: Vec<u8>,
    filename: String,
    mime: String,
    path: Option<std::path::PathBuf>,
}

/// Sends the upload and reads the image's URL out of the answer.
async fn send(
    preset: &Preset,
    mut url: reqwest::Url,
    token: Option<String>,
    url_field: &str,
    image: Image,
) -> Result<String, String> {
    let name = preset.name;
    if let (Auth::KeyQuery, Some(token)) = (&preset.auth, &token) {
        url.query_pairs_mut().append_pair("key", token);
    }
    let client = crate::net::client(CONNECT_TIMEOUT, UPLOAD_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.post(url);
    request = match preset.body {
        Body::Multipart(field) => {
            let part = reqwest::multipart::Part::bytes(image.bytes)
                .file_name(image.filename)
                .mime_str(&image.mime)
                .map_err(|e| e.to_string())?;
            request.multipart(reqwest::multipart::Form::new().part(field, part))
        }
        Body::PathList => {
            let path = image.path.ok_or("no file to upload")?;
            request.json(&serde_json::json!({ "list": [path] }))
        }
    };
    if let Some(token) = token {
        request = match preset.auth {
            Auth::Bearer => request.bearer_auth(token),
            Auth::Plain => request.header(reqwest::header::AUTHORIZATION, token),
            Auth::ClientId => {
                request.header(reqwest::header::AUTHORIZATION, format!("Client-ID {token}"))
            }
            Auth::KeyQuery => request,
        };
    }

    let response = request.send().await.map_err(|e| {
        if e.is_connect() && preset.loopback_only {
            format!("{name} isn't running, or its server is turned off")
        } else if e.is_timeout() {
            format!("{name} didn't answer in time")
        } else {
            format!("couldn't reach {name}: {e}")
        }
    })?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = crate::net::read_limited(response, MAX_ANSWER_BYTES)
        .await?
        .ok_or_else(|| format!("{name} returned {status} and an answer too large to read"))?;
    let body = String::from_utf8_lossy(&body);
    if !status.is_success() {
        return Err(if is_html(content_type.as_deref(), &body) {
            format!("{name} returned {status}.")
        } else {
            format!("{name} returned {status}: {}", first_line(&body))
        });
    }

    let trimmed = body.trim();
    if valid_public_url(trimmed) {
        return Ok(trimmed.to_string());
    }
    let json: Value = serde_json::from_str(trimmed)
        .map_err(|_| format!("{name} answered with neither a URL nor JSON"))?;
    let user_field = [url_field.trim()];
    let fields: &[&str] = if preset.url_fields.is_empty() {
        &user_field
    } else {
        preset.url_fields
    };
    let Some(src) = fields.iter().find_map(|field| response_url(&json, field)) else {
        // PicGo and SM.MS say why with success: false and a message.
        return Err(match json.get("message").and_then(Value::as_str) {
            Some(message) => format!("{name}: {message}"),
            None if preset.url_fields.is_empty() => {
                format!("image URL field `{}` was not found", url_field.trim())
            }
            None => format!("{name}'s answer has no image URL"),
        });
    };
    if !valid_public_url(&src) {
        return Err(format!("{name} returned an invalid public URL"));
    }
    Ok(src)
}

#[tauri::command]
pub async fn upload_image(
    app: AppHandle,
    host: ImageHost,
    data_base64: String,
    mime: String,
    filename: String,
    endpoint: String,
    url_field: String,
) -> Result<UploadedImage, String> {
    let preset = host.preset();
    let url = upload_url(&preset, &endpoint)?;
    if filename.is_empty() || filename.contains(['/', '\\']) || filename == "." || filename == ".."
    {
        return Err("invalid image filename".to_string());
    }

    let bytes = STANDARD.decode(data_base64).map_err(|e| e.to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("image is empty or exceeds the 25 MB limit".to_string());
    }
    let token = load_provider_key(&app, host.credential_id())?;

    // PicGo reads the image from a file, named as it will be uploaded: one
    // in a private folder of its own, removed when `folder` drops - once
    // PicGo has answered, or when a paste given up on drops this future.
    let mut folder = (preset.body == Body::PathList)
        .then(|| TempDir::create("textus-upload-"))
        .transpose()
        .map_err(|e| e.to_string())?;
    let path = match &mut folder {
        Some(folder) => Some(
            folder
                .write_file(&filename, &bytes)
                .map_err(|e| e.to_string())?,
        ),
        None => None,
    };
    let image = Image {
        bytes,
        filename,
        mime,
        path,
    };
    let src = send(&preset, url, token, &url_field, image).await?;
    Ok(UploadedImage { src })
}

#[cfg(test)]
mod tests {
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
}
