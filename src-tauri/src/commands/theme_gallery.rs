//! The public theme gallery (github.com/CatVinci-Studio/textus-themes),
//! browsed from Settings › Editor & Appearance › More themes › Browse themes.
//!
//! Every request goes to one fixed place: the gallery repository's files on
//! raw.githubusercontent.com. The frontend names a file by its path inside
//! that repository, as the catalog gives it (`themes/<id>/theme.css`), never
//! by URL, and a path is checked against the shape the gallery uses before
//! it is joined to the base - so a catalog or a page can't point the app at
//! another host, another repository, or anything but a theme's stylesheet
//! and its screenshots. Nothing is fetched until the gallery page is opened.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

const GALLERY_BASE: &str = "https://raw.githubusercontent.com/CatVinci-Studio/textus-themes/main/";
const CATALOG_PATH: &str = "index.json";

/// The gallery accepts a stylesheet up to 200 KB and screenshots up to 2 MB
/// (its README); a little over each, so a file at the limit still loads.
const MAX_CATALOG_BYTES: usize = 1024 * 1024;
const MAX_CSS_BYTES: usize = 256 * 1024;
const MAX_PREVIEW_BYTES: usize = 2 * 1024 * 1024 + 64 * 1024;
const MAX_PREVIEWS: usize = 2;

/// Short: the page shows a spinner until this answers, and an offline
/// machine should see the "couldn't reach" message, not a long wait.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// One theme of the catalog, as the frontend gets it - generated into
/// src/platform/bindings/app.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GalleryTheme {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub created: String,
    pub updated: String,
    /// Repository-relative, e.g. `themes/plain/theme.css`.
    pub css: String,
    /// Repository-relative screenshots.
    #[serde(default)]
    pub previews: Vec<String>,
}

/// A gallery theme id: what the gallery's own check allows (lowercase
/// letters, digits, `-`), and a safe path component.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn valid_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// The URL of a theme's file in the gallery, or None for anything that
/// isn't `themes/<id>/<file>.<one of extensions>`.
fn gallery_file_url(path: &str, extensions: &[&str]) -> Option<String> {
    let parts: Vec<&str> = path.split('/').collect();
    let [dir, id, file] = parts.as_slice() else {
        return None;
    };
    if *dir != "themes" || !valid_id(id) || !valid_file_name(file) {
        return None;
    }
    let ext = file.rsplit_once('.')?.1.to_ascii_lowercase();
    if !extensions.contains(&ext.as_str()) {
        return None;
    }
    Some(format!("{GALLERY_BASE}{path}"))
}

fn css_url(path: &str) -> Option<String> {
    gallery_file_url(path, &["css"])
}

fn preview_url(path: &str) -> Option<String> {
    gallery_file_url(path, &["png", "jpg", "jpeg", "webp"])
}

fn clip(text: &str, max_chars: usize) -> String {
    text.trim().chars().take(max_chars).collect()
}

/// The catalog's themes the app can show and install. An entry that is
/// malformed, or names a file outside the gallery's shape, is left out
/// rather than failing the whole list.
fn parse_catalog(bytes: &[u8]) -> Result<Vec<GalleryTheme>, String> {
    let root: Value = serde_json::from_slice(bytes).map_err(|_| "catalog is not JSON")?;
    let entries = root
        .get("themes")
        .and_then(Value::as_array)
        .ok_or("catalog has no theme list")?;
    let mut themes: Vec<GalleryTheme> = Vec::new();
    for entry in entries {
        let Ok(mut theme) = serde_json::from_value::<GalleryTheme>(entry.clone()) else {
            continue;
        };
        if !valid_id(&theme.id)
            || theme.name.trim().is_empty()
            || theme.updated.trim().is_empty()
            || css_url(&theme.css).is_none()
            || themes.iter().any(|t| t.id == theme.id)
        {
            continue;
        }
        theme.previews.retain(|p| preview_url(p).is_some());
        theme.previews.truncate(MAX_PREVIEWS);
        theme.name = clip(&theme.name, 80);
        theme.author = clip(&theme.author, 80);
        theme.description = clip(&theme.description, 400);
        theme.license = clip(&theme.license, 40);
        theme.updated = clip(&theme.updated, 40);
        theme.created = clip(&theme.created, 40);
        // Only a link to the author's repository is meaningful here.
        if !theme.source.starts_with("https://github.com/") {
            theme.source = String::new();
        }
        themes.push(theme);
    }
    Ok(themes)
}

/// `css` without its comments, so a remark that mentions `@import` or
/// `url(` isn't read as one. An unclosed comment runs to the end, as in CSS.
fn without_comments(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(start) = rest.find("/*") {
        out.push_str(&rest[..start]);
        out.push(' ');
        rest = match rest[start + 2..].find("*/") {
            Some(end) => &rest[start + 2 + end + 2..],
            None => "",
        };
    }
    out.push_str(rest);
    out
}

/// `css` with every quoted string emptied (`content: "@import"` is text,
/// not a rule). The quotes stay; a backslash escapes the next character.
fn without_strings(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut chars = css.chars();
    while let Some(c) = chars.next() {
        out.push(c);
        if c != '"' && c != '\'' {
            continue;
        }
        while let Some(inner) = chars.next() {
            if inner == '\\' {
                chars.next();
            } else if inner == c {
                out.push(c);
                break;
            }
        }
    }
    out
}

/// The gallery's rule (its README): one self-contained file - no `@import`,
/// and every `url()` a `data:` URI. A theme that breaks it would fetch from
/// some server each time it is shown, so it isn't installed. Comments never
/// count, and strings don't for `@import`; a `url("...")` target is a
/// string, though, and is checked.
fn check_self_contained(css: &str) -> Result<(), String> {
    let code = without_comments(css).to_ascii_lowercase();
    if without_strings(&code).contains("@import") {
        return Err("the theme loads another stylesheet (@import)".into());
    }
    let mut rest = code.as_str();
    while let Some(at) = rest.find("url(") {
        let target = rest[at + 4..].trim_start().trim_start_matches(['"', '\'']);
        if !target.trim_start().starts_with("data:") {
            return Err("the theme loads a file from the internet (url())".into());
        }
        rest = &rest[at + 4..];
    }
    Ok(())
}

/// The image type a screenshot's bytes are, from its signature rather than
/// its name or the server's word for it.
fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

async fn fetch(url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let client = crate::net::client(CONNECT_TIMEOUT, REQUEST_TIMEOUT)
        // The allow-list is the URL asked for; a redirect would leave it.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(url).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("the gallery answered {status}"));
    }
    crate::net::read_limited(response, limit)
        .await?
        .ok_or_else(|| "the file is larger than the gallery allows".into())
}

/// The gallery's catalog (index.json).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn theme_gallery_catalog() -> Result<Vec<GalleryTheme>, String> {
    let bytes = fetch(&format!("{GALLERY_BASE}{CATALOG_PATH}"), MAX_CATALOG_BYTES).await?;
    parse_catalog(&bytes)
}

/// A gallery theme's stylesheet, by its catalog path. The frontend saves it
/// with save_theme_css (commands/themes.rs), as Import CSS… does a file.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn theme_gallery_css(path: String) -> Result<String, String> {
    let url = css_url(&path).ok_or("not a gallery theme stylesheet")?;
    let bytes = fetch(&url, MAX_CSS_BYTES).await?;
    let css = String::from_utf8(bytes).map_err(|_| "the theme is not UTF-8 text")?;
    check_self_contained(&css)?;
    Ok(css)
}

/// A gallery screenshot, by its catalog path, as a `data:` URL - the page
/// shows it in an `<img>` and never loads anything from the network itself.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn theme_gallery_preview(path: String) -> Result<String, String> {
    let url = preview_url(&path).ok_or("not a gallery screenshot")?;
    let bytes = fetch(&url, MAX_PREVIEW_BYTES).await?;
    let mime = image_mime(&bytes).ok_or("the screenshot is not an image")?;
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{data}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_theme_files_in_the_gallery_repository_are_fetched() {
        assert_eq!(
            css_url("themes/plain/theme.css").as_deref(),
            Some("https://raw.githubusercontent.com/CatVinci-Studio/textus-themes/main/themes/plain/theme.css")
        );
        assert!(preview_url("themes/midnight-ink/preview.png").is_some());
        assert!(preview_url("themes/lumen/preview-2.WEBP").is_some());

        for path in [
            "https://example.com/theme.css",
            "//example.com/theme.css",
            "/themes/plain/theme.css",
            "themes/../index.json",
            "themes/plain/../../x/theme.css",
            "themes/plain/sub/theme.css",
            "themes/Plain/theme.css",
            "themes/plain/.theme.css",
            "themes/plain/theme.css?x=1",
            "themes/plain/theme.css#x",
            "themes/plain%2f../theme.css",
            "themes/plain\\theme.css",
            "pending/plain/theme.css",
            "themes/plain/theme.js",
            "themes//theme.css",
            "",
        ] {
            assert!(css_url(path).is_none(), "{path} was allowed");
        }
        // A stylesheet is not a screenshot, nor the other way round.
        assert!(preview_url("themes/plain/theme.css").is_none());
        assert!(css_url("themes/plain/preview.png").is_none());
        assert!(preview_url("themes/plain/preview.svg").is_none());
    }

    #[test]
    fn the_catalog_keeps_well_formed_themes_and_drops_the_rest() {
        let catalog = br#"{
            "version": 1, "updated": "2026-10-18T04:55:06Z", "count": 5,
            "themes": [
                {"id": "plain", "name": "Plain", "author": "CatVinci-Studio",
                 "description": "Default look.", "license": "MIT",
                 "source": "https://github.com/CatVinci-Studio/textus-themes",
                 "created": "2026-10-18T04:55:06Z", "updated": "2026-10-18T04:55:06Z",
                 "css": "themes/plain/theme.css",
                 "previews": ["themes/plain/preview.png", "https://evil.test/x.png", "themes/plain/b.jpg", "themes/plain/c.webp"]},
                {"id": "evil", "name": "Evil", "updated": "2026-10-18T00:00:00Z",
                 "css": "https://evil.test/theme.css"},
                {"id": "../up", "name": "Up", "updated": "2026-10-18T00:00:00Z",
                 "css": "themes/up/theme.css"},
                {"id": "no-name", "updated": "2026-10-18T00:00:00Z",
                 "css": "themes/no-name/theme.css"},
                {"id": "plain", "name": "Plain again", "updated": "2026-10-19T00:00:00Z",
                 "css": "themes/plain/theme.css"},
                {"id": "minimal", "name": "Minimal", "updated": "2026-10-17T00:00:00Z",
                 "css": "themes/minimal/theme.css", "source": "javascript:alert(1)",
                 "extra": "ignored"}
            ]
        }"#;
        let themes = parse_catalog(catalog).unwrap();
        let ids: Vec<&str> = themes.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["plain", "minimal"]);
        assert_eq!(themes[0].author, "CatVinci-Studio");
        assert_eq!(
            themes[0].previews,
            ["themes/plain/preview.png", "themes/plain/b.jpg"]
        );
        assert_eq!(themes[1].source, "");
        assert!(themes[1].previews.is_empty());
    }

    #[test]
    fn a_catalog_that_is_not_one_is_an_error() {
        assert!(parse_catalog(b"<html>").is_err());
        assert!(parse_catalog(br#"{"version": 1}"#).is_err());
        assert_eq!(parse_catalog(br#"{"themes": []}"#).unwrap(), vec![]);
    }

    #[test]
    fn only_self_contained_stylesheets_are_installed() {
        assert!(check_self_contained("#write { color: red; }").is_ok());
        assert!(check_self_contained(
            "@font-face { src: url(\"data:font/woff2;base64,AAAA\"); } #write { background: URL( 'data:image/png;base64,AA' ) }"
        )
        .is_ok());
        assert!(check_self_contained("@import url(\"https://x.test/a.css\");").is_err());
        assert!(check_self_contained("@IMPORT 'b.css';").is_err());
        assert!(check_self_contained("#write { background: url(https://x.test/p.png) }").is_err());
        assert!(check_self_contained("#write { background: url( 'fonts/a.woff2' ) }").is_err());
    }

    #[test]
    fn comments_and_text_that_mention_imports_or_urls_are_not_rules() {
        assert!(check_self_contained(
            "/* No @import here: every url(...) is a data: URI. */\n#write { color: red; }"
        )
        .is_ok());
        assert!(check_self_contained(r#"#write p::after { content: "@import 'x.css';" }"#).is_ok());
        assert!(check_self_contained(r"#write::before { content: 'it\'s @import' }").is_ok());
        // A rule after a comment still counts; a comment left open hides the rest.
        assert!(check_self_contained("/* x */ @import 'a.css';").is_err());
        assert!(
            check_self_contained("/* a */ #w { background: url(http://x.test/a.png) }").is_err()
        );
        assert!(check_self_contained("#w { color: red } /* @import 'a.css';").is_ok());
        // A url() target is a string, and is still checked.
        assert!(check_self_contained(r#"#w { background: url("https://x.test/a.png") }"#).is_err());
    }

    #[test]
    fn screenshots_are_recognised_by_their_bytes() {
        assert_eq!(image_mime(b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(image_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(image_mime(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(image_mime(b"<svg xmlns="), None);
        assert_eq!(image_mime(b"<html>"), None);
    }
}
