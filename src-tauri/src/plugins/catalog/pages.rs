//! A catalog plugin's page: its README in the reader's language, and its
//! icon.

use super::download::download;
use super::FETCHED;

/// A README this large is not a README.
const MAX_README: usize = 512 * 1024;

/// The README of plugin `id` in the catalog last fetched, in `language`
/// where it has one ("zh-Hant", then "zh"), else in English; None when it
/// has none.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_catalog_readme(id: String, language: String) -> Result<Option<String>, String> {
    let readme = FETCHED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .find(|e| e.id == id)
        .map(|e| e.readme.clone())
        .unwrap_or_default();
    let Some(url) = readme_for(&readme, &language) else {
        return Ok(None);
    };
    let bytes = download(&url, &id).await?;
    if bytes.len() > MAX_README {
        return Err(format!("{id}'s README is too large to show."));
    }
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}

/// An icon larger than this is no icon.
const MAX_ICON: usize = 256 * 1024;

/// Plugin `id`'s icon in the catalog last fetched, as a data: URL; None when
/// it has none. Fetched here: GitHub serves release files as
/// application/octet-stream, which an <img> won't draw as an SVG.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_catalog_icon(id: String) -> Result<Option<String>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let icon = FETCHED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .find(|e| e.id == id)
        .and_then(|e| e.icon.clone());
    let Some(url) = icon else {
        return Ok(None);
    };
    let mime = if url.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "image/png"
    };
    let bytes = download(&url, &id).await?;
    if bytes.len() > MAX_ICON {
        return Ok(None);
    }
    Ok(Some(format!(
        "data:{mime};base64,{}",
        STANDARD.encode(bytes)
    )))
}

/// The README for `language` among `readme`'s: the language itself, its
/// base ("pt" for "pt-BR"), then English. Traditional Chinese reads the
/// English, never the Simplified.
pub(super) fn readme_for(
    readme: &std::collections::BTreeMap<String, String>,
    language: &str,
) -> Option<String> {
    let base = match language {
        "zh-Hant" => "en",
        _ => language.split('-').next().unwrap_or(language),
    };
    [language, base, "en"]
        .iter()
        .find_map(|lang| readme.get(*lang))
        .cloned()
}
