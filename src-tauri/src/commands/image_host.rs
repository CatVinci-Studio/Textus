//! Uploads pasted editor images to the image host chosen in Settings. Each
//! host is a preset sharing one upload path; "Custom" takes multipart `file`,
//! an optional bearer token, and a plain URL or JSON at a configured field path.

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

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
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
    /// `{"list": [path]}` naming a file on this machine: the PicGo server's upload.
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

    /// Where its token is kept: the credential store shared with the AI providers'
    /// keys, under an id never shown as a provider.
    fn credential_id(self) -> &'static str {
        match self {
            ImageHost::Picgo => "__image_host_picgo",
            ImageHost::Smms => "__image_host_smms",
            ImageHost::Imgur => "__image_host_imgur",
            // Custom's id predates the presets and must stay.
            ImageHost::Custom => "__image_host",
        }
    }
}

#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
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
#[cfg_attr(test, specta::specta)]
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

    // PicGo reads the image from a file named as it will be uploaded, in a
    // private folder removed when `folder` drops.
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
mod tests;
