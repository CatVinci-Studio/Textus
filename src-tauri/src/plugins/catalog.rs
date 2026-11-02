//! The plugins Textus offers to install, from the textus-plugins catalog. Only
//! Rust fetches the catalog and packages, from fixed addresses, and checks each
//! package's SHA-256, so "Official" is decided here, not by the window.

use super::{install, state};
use crate::ext_stats;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::Mutex;

/// Where the catalog names its files: the textus-plugins repository's
/// releases. Anything else in it is left out.
const PACKAGE_PREFIX: &str = "https://github.com/CatVinci-Studio/textus-plugins/releases/download/";

/// Where the app reads them: Textus's own site passes each release file on,
/// so the store works where GitHub can't be reached.
const MIRROR_PREFIX: &str = "https://textus.catvinci.com/plugin-release/";
const CATALOG_URL: &str = "https://textus.catvinci.com/plugin-release/catalog/index.json";
const DOWNLOAD_HOSTS: [&str; 1] = ["textus.catvinci.com"];

/// A release file's address on the site; None for one from elsewhere.
fn mirrored(url: &str) -> Option<String> {
    url.strip_prefix(PACKAGE_PREFIX)
        .map(|rest| format!("{MIRROR_PREFIX}{rest}"))
}

/// A package this large is not a plugin.
const MAX_PACKAGE: u64 = 200 * 1024 * 1024;

/// One plugin in the catalog.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub id: String,
    pub version: String,
    #[serde(default)]
    pub official: bool,
    /// Its whole manifest, for Settings to show before it is installed.
    pub manifest: Value,
    pub url: String,
    pub sha256: String,
    pub size: u64,
    /// Pictures of it at work, for the market (from the repository's releases;
    /// any other is left out).
    #[serde(default)]
    pub screenshots: Vec<String>,
    /// Its README by language code ("en" for README.md), for its page in
    /// the market; fetched by `plugin_catalog_readme`.
    #[serde(default)]
    pub readme: std::collections::BTreeMap<String, String>,
    /// Its icon (SVG or PNG), from the repository's releases.
    #[serde(default)]
    pub icon: Option<String>,
    /// How many devices installed it, ever and in the last 30 days (counted
    /// by services/ext-stats; not reinstalls or updates).
    #[serde(default)]
    pub installs: Option<u64>,
    #[serde(default)]
    pub installs30: Option<u64>,
    /// When its first and latest versions came out (YYYY-MM-DD).
    #[serde(default)]
    pub published: Option<String>,
    #[serde(default)]
    pub updated: Option<String>,
}

/// One skill in the catalog, listed beside the plugins in the market.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SkillEntry {
    /// What it is called in the `/` menu.
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub official: bool,
    /// The panel modes it works in (its file's `textus-modes`); Write's
    /// when the catalog doesn't say.
    #[serde(default = "write_mode")]
    pub modes: Vec<crate::ai::agent::AgentMode>,
    /// Its name and one-line hint by UI language code, for the market to
    /// show (its file's `textus-label-<code>`).
    #[serde(default)]
    pub labels: std::collections::BTreeMap<String, crate::ai::workspace::SkillLabel>,
    pub url: String,
    pub sha256: String,
    pub size: u64,
    /// As a plugin's.
    #[serde(default)]
    pub installs: Option<u64>,
    #[serde(default)]
    pub installs30: Option<u64>,
}

fn write_mode() -> Vec<crate::ai::agent::AgentMode> {
    vec![crate::ai::agent::AgentMode::Write]
}

#[derive(Deserialize)]
struct Catalog {
    schema: u32,
    plugins: Vec<CatalogEntry>,
    /// An older catalog has no skills.
    #[serde(default)]
    skills: Vec<SkillEntry>,
}

/// The catalog as last fetched, for an install to take its entry from.
static FETCHED: Mutex<Vec<CatalogEntry>> = Mutex::new(Vec::new());
static FETCHED_SKILLS: Mutex<Vec<SkillEntry>> = Mutex::new(Vec::new());

/// A skill file this large is not a skill.
const MAX_SKILL: u64 = 256 * 1024;

fn download_host(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some_and(|h| DOWNLOAD_HOSTS.contains(&h))
}

fn client() -> Result<reqwest::Client, String> {
    client_with(reqwest::redirect::Policy::custom(|attempt| {
        if download_host(attempt.url()) && attempt.previous().len() < 5 {
            attempt.follow()
        } else {
            attempt.stop()
        }
    }))
}

fn client_with(redirects: reqwest::redirect::Policy) -> Result<reqwest::Client, String> {
    use std::time::Duration;
    // Connecting gives up soon, so an unreachable counting endpoint falls
    // back quickly.
    crate::net::public_client(Duration::from_secs(10), Duration::from_secs(120))?
        .user_agent(crate::app_identity::APP_NAME)
        .redirect(redirects)
        .build()
        .map_err(|e| e.to_string())
}

/// The catalog's address: the published one, or TEXTUS_PLUGIN_CATALOG for
/// testing one before it is published.
fn catalog_url() -> String {
    std::env::var("TEXTUS_PLUGIN_CATALOG").unwrap_or_else(|_| CATALOG_URL.to_string())
}

fn parse_all(text: &str) -> Result<(Vec<CatalogEntry>, Vec<SkillEntry>), String> {
    let catalog: Catalog =
        serde_json::from_str(text).map_err(|e| format!("The plugin catalog can't be read: {e}"))?;
    if catalog.schema != 1 {
        return Err("The plugin catalog is for a newer Textus - update Textus to see it.".into());
    }
    let plugins = catalog
        .plugins
        .into_iter()
        .filter(|p| super::require_id(&p.id).is_ok())
        .filter_map(|mut p| {
            p.url = mirrored(&p.url)?;
            p.screenshots = p
                .screenshots
                .iter()
                .filter_map(|url| mirrored(url))
                .collect();
            p.readme = std::mem::take(&mut p.readme)
                .into_iter()
                .filter_map(|(lang, url)| Some((lang, mirrored(&url)?)))
                .collect();
            p.icon = p.icon.as_deref().and_then(mirrored);
            Some(p)
        })
        .collect();
    let skills = catalog
        .skills
        .into_iter()
        .filter(|s| !s.name.trim().is_empty() && s.size <= MAX_SKILL)
        .filter_map(|mut s| {
            s.url = mirrored(&s.url)?;
            Some(s)
        })
        .collect();
    Ok((plugins, skills))
}

fn parse(text: &str) -> Result<Vec<CatalogEntry>, String> {
    let (plugins, skills) = parse_all(text)?;
    *FETCHED_SKILLS.lock().unwrap_or_else(|e| e.into_inner()) = skills;
    Ok(plugins)
}

/// The skills the catalog last fetched (or kept) lists.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn skill_catalog() -> Vec<SkillEntry> {
    FETCHED_SKILLS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

/// The catalog as last fetched, kept in the cache folder so Get plugins can
/// list it at once, even offline.
fn cache_file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("plugin-catalog.json"))
}

/// Fetches the catalog's text from its address.
async fn fetch() -> Result<String, String> {
    let url = catalog_url();
    if let Some(path) = url.strip_prefix("file://") {
        return std::fs::read_to_string(path).map_err(|e| e.to_string());
    }
    let response = client()?.get(&url).send().await.map_err(|e| {
        format!(
            "Couldn't reach the plugin catalog: {}",
            crate::net::error_text(&e)
        )
    })?;
    if !response.status().is_success() {
        return Err(format!(
            "The plugin catalog answered {}.",
            response.status()
        ));
    }
    response.text().await.map_err(|e| e.to_string())
}

/// The catalog, fetched now and kept for next time.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_catalog(app: tauri::AppHandle) -> Result<Vec<CatalogEntry>, String> {
    let text = fetch().await?;
    let entries = parse(&text)?;
    *FETCHED.lock().unwrap_or_else(|e| e.into_inner()) = entries.clone();
    // Only a cache: a catalog that can't be kept is fetched again next time.
    if let Ok(path) = cache_file(&app) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, text);
    }
    Ok(entries)
}

/// The catalog as last fetched, shown while a fresh one loads. Installing from
/// it is safe: a version's package never changes, so its checksum holds.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_catalog_cached(app: tauri::AppHandle) -> Option<Vec<CatalogEntry>> {
    let text = std::fs::read_to_string(cache_file(&app).ok()?).ok()?;
    let entries = parse(&text).ok()?;
    let mut fetched = FETCHED.lock().unwrap_or_else(|e| e.into_inner());
    if fetched.is_empty() {
        *fetched = entries.clone();
    }
    Some(entries)
}

/// Whether `bytes` is the package the catalog describes.
fn checked(entry: &CatalogEntry, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 != entry.size {
        return Err(format!(
            "The download of {} is {} bytes, not the {} the catalog says - try again.",
            entry.id,
            bytes.len(),
            entry.size
        ));
    }
    let hash = hex(&Sha256::digest(bytes));
    if !hash.eq_ignore_ascii_case(&entry.sha256) {
        return Err(format!(
            "The download of {} isn't the package the catalog lists - it was not installed.",
            entry.id
        ));
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Downloads `url` from the catalog's own address.
async fn download(url: &str, what: &str) -> Result<Vec<u8>, String> {
    download_with(client()?, url, what).await
}

/// Downloads a package, through the counting endpoint when counts are on.
async fn download_counted(
    app: &tauri::AppHandle,
    package: ext_stats::Download<'_>,
    what: &str,
) -> Result<Vec<u8>, String> {
    let direct = package.direct;
    let counted = ext_stats::counted_url(app, &package);
    let client = client_with(ext_stats::redirects(direct, download_host))?;
    ext_stats::counted_or_direct(counted, direct, |url| {
        let client = client.clone();
        async move { download_with(client, &url, what).await }
    })
    .await
}

async fn download_with(client: reqwest::Client, url: &str, what: &str) -> Result<Vec<u8>, String> {
    if let Some(path) = url.strip_prefix("file://") {
        return std::fs::read(path).map_err(|e| e.to_string());
    }
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Couldn't download {what}: {}", crate::net::error_text(&e)))?;
    ext_stats::check_redirected(&response)?;
    if !response.status().is_success() {
        return Err(format!(
            "The download of {what} answered {}.",
            response.status()
        ));
    }
    Ok(response.bytes().await.map_err(|e| e.to_string())?.to_vec())
}

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
/// base ("zh" for "zh-Hant"), then English.
fn readme_for(
    readme: &std::collections::BTreeMap<String, String>,
    language: &str,
) -> Option<String> {
    let base = language.split('-').next().unwrap_or(language);
    [language, base, "en"]
        .iter()
        .find_map(|lang| readme.get(*lang))
        .cloned()
}

/// The error when a skill of that name exists already; it is never overwritten.
pub const SKILL_EXISTS: &str = "SKILL_EXISTS";

/// Installs skill `name` from the catalog last fetched into the global skills/
/// folder, after checking it. Returns its path.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn skill_install_catalog(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let entry = FETCHED_SKILLS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .find(|s| s.name == name)
        .cloned()
        .ok_or_else(|| format!("{name} isn't in the catalog."))?;
    let package = ext_stats::Download {
        kind: ext_stats::Kind::Skill,
        id: &entry.name,
        version: &entry.version,
        update: false,
        present: false,
        direct: &entry.url,
    };
    let bytes = download_counted(&app, package, &name).await?;
    if bytes.len() as u64 != entry.size
        || !hex(&Sha256::digest(&bytes)).eq_ignore_ascii_case(&entry.sha256)
    {
        return Err(format!(
            "The download of {name} isn't the file the catalog lists - it was not installed."
        ));
    }
    let text = String::from_utf8(bytes).map_err(|_| format!("{name} isn't a skill file."))?;
    let path = install_skill_in(
        &crate::ai::workspace::global_agent_dir(&app)?.join("skills"),
        &entry.name,
        &text,
    )?;
    ext_stats::installed(&app, ext_stats::Kind::Skill, &entry.name);
    Ok(path.to_string_lossy().into_owned())
}

/// Writes a skill file named `name` into `dir`, never over one there.
fn install_skill_in(
    dir: &std::path::Path,
    name: &str,
    text: &str,
) -> Result<std::path::PathBuf, String> {
    let skill = crate::ai::workspace::parse_skill_file(name, text);
    if skill.prompt.is_empty() {
        return Err(format!("{name} isn't a skill file."));
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = crate::ai::workspace::skill_file_path(dir, name)?;
    let taken = crate::ai::workspace::read_skill_files(dir)
        .iter()
        .any(|(_, s)| s.name.eq_ignore_ascii_case(&skill.name));
    if path.exists() || taken {
        return Err(SKILL_EXISTS.into());
    }
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Installs `id` from the catalog last fetched after checking its package,
/// marked Official when the catalog says it is CatVinci's.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_install_catalog(
    app: tauri::AppHandle,
    id: String,
) -> Result<install::InstalledPlugin, String> {
    super::require_id(&id)?;
    let entry = FETCHED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .find(|e| e.id == id)
        .cloned()
        .ok_or_else(|| format!("{id} isn't in the plugin catalog."))?;
    if entry.size > MAX_PACKAGE {
        return Err(format!("{id}'s package is too large to install."));
    }
    let root = super::plugins_root(&app)?;
    let present = installed_version(&root, &id);
    let package = ext_stats::Download {
        kind: ext_stats::Kind::Plugin,
        id: &id,
        version: &entry.version,
        update: present.as_ref().is_some_and(|v| *v != entry.version),
        present: present.is_some(),
        direct: &entry.url,
    };
    let bytes = download_counted(&app, package, &id).await?;
    checked(&entry, &bytes)?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let package = root.join(format!(".download-{id}.zip"));
    std::fs::write(&package, &bytes).map_err(|e| e.to_string())?;
    let installed = {
        let app = app.clone();
        let package = package.clone();
        tauri::async_runtime::spawn_blocking(move || install::install_sync(&app, &package))
            .await
            .map_err(|e| e.to_string())?
    };
    let _ = std::fs::remove_file(&package);
    let installed = installed?;
    if installed.id != id {
        return Err(format!(
            "The package for {id} holds {} instead.",
            installed.id
        ));
    }
    state::update(&app, |state| {
        state.plugins.entry(id.clone()).or_default().official = entry.official;
    })?;
    ext_stats::installed(&app, ext_stats::Kind::Plugin, &id);
    Ok(installed)
}

/// The version of plugin `id` installed in `root`, if one is.
pub(super) fn installed_version(root: &std::path::Path, id: &str) -> Option<String> {
    let text = std::fs::read_to_string(root.join(id).join(super::MANIFEST)).ok()?;
    let manifest: Value = serde_json::from_str(&text).ok()?;
    Some(manifest.get("version")?.as_str()?.to_string())
}

#[cfg(test)]
mod tests;
