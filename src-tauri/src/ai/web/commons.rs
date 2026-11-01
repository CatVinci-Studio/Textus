//! Real pictures from Wikimedia Commons: searched by description, each with
//! its author and licence, so a document can show it with the credit its
//! licence asks for. Commons only - a picture found on any other page comes
//! with no licence to use it.

use super::search::http_client;
use serde_json::Value;

/// Results asked for per search, best first.
const RESULTS: usize = 8;
/// The width a picture is fetched at: enough for a page, small to keep.
const WIDTH: u32 = 1280;
/// Larger than this, a picture isn't kept.
const MAX_BYTES: usize = 6 * 1024 * 1024;

/// One picture on Commons and what showing it takes.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CommonsImage {
    /// Its file page, where the credit links to.
    pub page: String,
    /// The picture at WIDTH, to fetch.
    pub url: String,
    pub mime: String,
    pub width: u32,
    pub height: u32,
    /// Who made it, as plain text ("" when Commons doesn't say).
    pub author: String,
    /// "CC BY-SA 4.0", "Public domain", …
    pub license: String,
}

impl CommonsImage {
    /// The credit its licence asks for, in a line: author, licence, and
    /// where it is from.
    pub(crate) fn credit(&self) -> String {
        let who = if self.author.is_empty() {
            String::new()
        } else {
            format!("{} · ", self.author)
        };
        format!("{who}{} · [Wikimedia Commons]({})", self.license, self.page)
    }
}

/// The pictures on Commons that best match `query` - photographs and
/// drawings, not documents - best first.
pub(crate) async fn search(query: &str) -> Result<Vec<CommonsImage>, String> {
    let response = http_client()?
        .get("https://commons.wikimedia.org/w/api.php")
        .query(&[
            ("action", "query"),
            ("format", "json"),
            ("generator", "search"),
            ("gsrnamespace", "6"),
            ("gsrsearch", &format!("{query} filetype:bitmap")),
            ("gsrlimit", &RESULTS.to_string()),
            ("prop", "imageinfo"),
            ("iiprop", "url|mime|size|extmetadata"),
            ("iiurlwidth", &WIDTH.to_string()),
            ("iiextmetadatafilter", "Artist|LicenseShortName"),
        ])
        .send()
        .await
        .map_err(|e| format!("Wikimedia Commons couldn't be reached: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Wikimedia Commons answered {}", response.status()));
    }
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(images(&body))
}

/// The pictures in a Commons answer, in its search order; those without a
/// licence or a picture to fetch are left out.
pub(super) fn images(body: &Value) -> Vec<CommonsImage> {
    let mut pages: Vec<&Value> = body
        .pointer("/query/pages")
        .and_then(Value::as_object)
        .map(|pages| pages.values().collect())
        .unwrap_or_default();
    pages.sort_by_key(|p| p["index"].as_u64().unwrap_or(u64::MAX));
    pages
        .into_iter()
        .filter_map(|page| {
            let info = page.pointer("/imageinfo/0")?;
            let meta = &info["extmetadata"];
            let license = plain(meta.pointer("/LicenseShortName/value")?.as_str()?);
            let url = info["thumburl"].as_str().or(info["url"].as_str())?;
            let mime = info["mime"].as_str().unwrap_or("");
            if license.is_empty() || !mime.starts_with("image/") {
                return None;
            }
            Some(CommonsImage {
                page: info["descriptionurl"].as_str()?.to_string(),
                url: url.to_string(),
                mime: mime.to_string(),
                width: info["thumbwidth"]
                    .as_u64()
                    .or(info["width"].as_u64())
                    .unwrap_or(0) as u32,
                height: info["thumbheight"]
                    .as_u64()
                    .or(info["height"].as_u64())
                    .unwrap_or(0) as u32,
                author: plain(
                    meta.pointer("/Artist/value")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                ),
                license,
            })
        })
        .collect()
}

/// Commons' HTML-marked text ("<a href=…>Ann</a>") as plain words.
fn plain(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&amp;", "&")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// The picture's bytes, with its type and file extension as the picture
/// store keeps them.
pub(crate) async fn fetch(
    image: &CommonsImage,
) -> Result<aicompat::images::GeneratedImage, String> {
    let response = http_client()?
        .get(&image.url)
        .send()
        .await
        .map_err(|e| format!("The picture couldn't be fetched: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Wikimedia Commons answered {}", response.status()));
    }
    let declared = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let (mime, ext) = picture_type(&declared, &image.url);
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("The picture is too large.".into());
    }
    Ok(aicompat::images::GeneratedImage {
        bytes: bytes.to_vec(),
        mime,
        ext,
        width: image.width,
        height: image.height,
    })
}

/// A fetched picture's type and extension: what the server says it is,
/// else what its address ends in (before any `?query`), else JPEG.
pub(super) fn picture_type(declared: &str, url: &str) -> (&'static str, &'static str) {
    let ext = url
        .split(['?', '#'])
        .next()
        .unwrap_or(url)
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();
    let kind = match declared.split(';').next().unwrap_or("").trim() {
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/jpeg" => "jpg",
        _ => ext.as_str(),
    };
    match kind {
        "png" => ("image/png", "png"),
        "gif" => ("image/gif", "gif"),
        "webp" => ("image/webp", "webp"),
        _ => ("image/jpeg", "jpg"),
    }
}
