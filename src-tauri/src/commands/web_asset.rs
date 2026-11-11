//! Files on the web the window may no longer load itself under its Content
//! Security Policy: a theme's web fonts and their stylesheets, and a web
//! picture copied to the clipboard. Fetched here, by kind, and handed back
//! as data the page can use. Fonts and stylesheets are kept in the cache
//! folder, so a theme keeps its fonts offline once they have come.

use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::Duration;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_BYTES: usize = 20 * 1024 * 1024;
/// Font services pick the format by browser: this one gets woff2.
const BROWSER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum WebAssetKind {
    /// A stylesheet a theme `@import`s: its text.
    Stylesheet,
    /// A font a stylesheet's `@font-face` names: a data URL.
    Font,
    /// A picture: a data URL.
    Image,
}

/// `url` as the kind asked for: a stylesheet's text, or a font or picture
/// as a data URL. Only http(s) addresses on the public internet.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn web_asset(
    app: tauri::AppHandle,
    url: String,
    kind: WebAssetKind,
) -> Result<String, String> {
    let parsed = public_url(&url).ok_or("not a web address")?;
    let cached = (kind != WebAssetKind::Image)
        .then(|| cache_path(&app, &url))
        .flatten();
    if let Some(text) = cached
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok())
    {
        return Ok(text);
    }
    let bytes = fetch(parsed).await?;
    let answer = shaped(kind, &url, &bytes)?;
    if let Some(path) = cached {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, &answer);
    }
    Ok(answer)
}

/// `url` if it is http(s) to a named host or a public address: never this
/// machine or the local network.
fn public_url(url: &str) -> Option<reqwest::Url> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if !matches!(parsed.scheme(), "https" | "http") {
        return None;
    }
    let host = parsed.host_str()?.trim_matches(['[', ']']);
    let local = aicompat::public_address::is_local_name(host)
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| !aicompat::public_address::is_public(ip));
    (!local).then_some(parsed)
}

fn cache_path(app: &tauri::AppHandle, url: &str) -> Option<PathBuf> {
    use tauri::Manager;
    let key = format!("{:x}", Sha256::digest(url.as_bytes()));
    Some(
        app.path()
            .app_cache_dir()
            .ok()?
            .join("web-assets")
            .join(key),
    )
}

/// Only a public host, its addresses checked and pinned, no redirect
/// followed: an asset named in a theme or a document reaches nothing on
/// this machine or its network (web_fetch's client).
async fn fetch(url: reqwest::Url) -> Result<Vec<u8>, String> {
    let client = crate::ai::web::fetch::client_for(&url, Default::default()).await?;
    let response = client
        .get(url)
        .header(reqwest::header::USER_AGENT, BROWSER_AGENT)
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| crate::net::error_text(&e))?;
    if !response.status().is_success() {
        return Err(format!("the server answered {}", response.status()));
    }
    crate::net::read_limited(response, MAX_BYTES)
        .await?
        .ok_or_else(|| "the file is too large".to_string())
}

/// The fetched `bytes` as the kind asked for, refused when they are not that.
fn shaped(kind: WebAssetKind, url: &str, bytes: &[u8]) -> Result<String, String> {
    let data = |mime: &str| {
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        format!("data:{mime};base64,{encoded}")
    };
    match kind {
        WebAssetKind::Stylesheet => {
            let text = std::str::from_utf8(bytes).map_err(|_| "the stylesheet is not text")?;
            if text.trim_start().starts_with('<') {
                return Err("not a stylesheet".into());
            }
            Ok(text.to_string())
        }
        WebAssetKind::Font => font_mime(bytes, url)
            .map(data)
            .ok_or_else(|| "not a font".into()),
        WebAssetKind::Image => crate::media::sniff(bytes)
            .map(data)
            .ok_or_else(|| "not a picture".into()),
    }
}

fn font_mime(bytes: &[u8], url: &str) -> Option<&'static str> {
    if bytes.starts_with(b"wOF2") {
        Some("font/woff2")
    } else if bytes.starts_with(b"wOFF") {
        Some("font/woff")
    } else if bytes.starts_with(b"OTTO") {
        Some("font/otf")
    } else if bytes.starts_with(&[0, 1, 0, 0]) || bytes.starts_with(b"true") {
        Some("font/ttf")
    } else if url.to_ascii_lowercase().contains(".eot") && bytes.len() > 34 {
        Some("application/vnd.ms-fontobject")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_public_web_addresses_are_fetched() {
        assert!(public_url("https://fonts.googleapis.com/css2?family=Inter").is_some());
        assert!(public_url("http://example.com/a.woff2").is_some());
        for refused in [
            "file:///etc/passwd",
            "ftp://example.com/a.woff2",
            "http://localhost:1420/x.css",
            "http://127.0.0.1/x.css",
            "http://192.168.1.2/x.css",
            "http://10.0.0.1/x.css",
            "http://[::1]/x.css",
            "http://printer.local/x.css",
            "asset://localhost/x.css",
            // What only the shared check knew: CGNAT, internal names.
            "http://100.64.0.1/x.css",
            "http://nas.internal/x.css",
            "http://router.home.arpa/x.css",
        ] {
            assert!(public_url(refused).is_none(), "{refused}");
        }
    }

    #[test]
    fn a_kind_is_refused_when_the_bytes_are_something_else() {
        let woff2 = b"wOF2\0\x01rest";
        assert!(shaped(WebAssetKind::Font, "https://x/a.woff2", woff2)
            .unwrap()
            .starts_with("data:font/woff2;base64,"));
        assert!(shaped(WebAssetKind::Font, "https://x/a.woff2", b"<html>").is_err());
        assert!(shaped(
            WebAssetKind::Stylesheet,
            "https://x/a.css",
            b"<!doctype html>"
        )
        .is_err());
        assert_eq!(
            shaped(WebAssetKind::Stylesheet, "https://x/a.css", b"@font-face{}").unwrap(),
            "@font-face{}"
        );
        assert!(shaped(
            WebAssetKind::Image,
            "https://x/a.png",
            b"\x89PNG\r\n\x1a\nrest"
        )
        .unwrap()
        .starts_with("data:image/png;base64,"));
        assert!(shaped(WebAssetKind::Image, "https://x/a.png", woff2).is_err());
    }
}
