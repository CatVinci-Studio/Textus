//! Real pictures from Openverse, the openly licensed media index (Flickr,
//! museums, Wikimedia and more): searched by description when Commons has
//! nothing, each with its author and licence. Only licences that let a
//! paper show the picture as it is, commercial use included, are asked for -
//! CC BY, CC BY-SA, CC0 and the public domain mark - and checked again here,
//! since Openverse passes on what each source says without checking it.

use super::commons::fetch_picture;
use super::search::http_client;
use serde_json::Value;

/// Results asked for per search, best first.
const RESULTS: usize = 8;
/// The licences asked for, as Openverse names them.
const LICENCES: [&str; 4] = ["by", "by-sa", "cc0", "pdm"];

/// One picture found through Openverse and what showing it takes.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct OpenverseImage {
    /// Its page where it is kept, where the credit links to.
    pub page: String,
    /// The picture itself, to fetch.
    pub url: String,
    pub width: u32,
    pub height: u32,
    /// Who made it, as plain text ("" when the source doesn't say).
    pub author: String,
    /// "CC BY 2.0", "CC0 1.0", "Public domain".
    pub license: String,
    /// Where it is kept: "Flickr", …, else "Openverse".
    pub site: String,
}

impl OpenverseImage {
    /// The credit its licence asks for, in a line: author, licence, and
    /// where it is from.
    pub(crate) fn credit(&self) -> String {
        let who = if self.author.is_empty() {
            String::new()
        } else {
            format!("{} · ", self.author)
        };
        format!("{who}{} · [{}]({})", self.license, self.site, self.page)
    }
}

/// The pictures on Openverse that best match `query`, best first.
pub(crate) async fn search(query: &str) -> Result<Vec<OpenverseImage>, String> {
    let response = http_client()?
        .get("https://api.openverse.org/v1/images/")
        .query(&[
            ("q", query),
            ("license", &LICENCES.join(",")),
            ("page_size", &RESULTS.to_string()),
            ("mature", "false"),
        ])
        .send()
        .await
        .map_err(|e| format!("Openverse couldn't be reached: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Openverse answered {}", response.status()));
    }
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(images(&body))
}

/// The pictures in an Openverse answer, in its order; those under another
/// licence, or without a page or a picture to fetch, are left out.
pub(super) fn images(body: &Value) -> Vec<OpenverseImage> {
    body["results"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|found| {
            let license = license(
                found["license"].as_str()?,
                found["license_version"].as_str().unwrap_or(""),
            )?;
            let url = found["url"]
                .as_str()
                .filter(|u| u.starts_with("https://"))?;
            let page = found["foreign_landing_url"]
                .as_str()
                .filter(|p| p.starts_with("http"))?;
            Some(OpenverseImage {
                page: page.to_string(),
                url: url.to_string(),
                width: found["width"].as_u64().unwrap_or(0) as u32,
                height: found["height"].as_u64().unwrap_or(0) as u32,
                author: found["creator"]
                    .as_str()
                    .unwrap_or("")
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" "),
                license,
                site: site(found["source"].as_str().unwrap_or("")),
            })
        })
        .collect()
}

/// A licence asked for, as a credit names it; None for any other.
fn license(code: &str, version: &str) -> Option<String> {
    let name = match code {
        "by" => "CC BY",
        "by-sa" => "CC BY-SA",
        "cc0" => "CC0",
        "pdm" => return Some("Public domain".into()),
        _ => return None,
    };
    Some(if version.is_empty() {
        name.to_string()
    } else {
        format!("{name} {version}")
    })
}

/// The name a credit gives the place a picture is kept.
fn site(source: &str) -> String {
    match source {
        "flickr" => "Flickr",
        "wikimedia" => "Wikimedia Commons",
        s if s.starts_with("smithsonian") => "Smithsonian",
        _ => "Openverse",
    }
    .to_string()
}

/// The picture's bytes, with its type and file extension as the picture
/// store keeps them.
pub(crate) async fn fetch(
    image: &OpenverseImage,
) -> Result<aicompat::images::GeneratedImage, String> {
    fetch_picture(&image.url, image.width, image.height, &image.site).await
}
