//! The plugins Textus offers to install, from the textus-plugins catalog. Only
//! Rust fetches the catalog and packages, from fixed addresses, and checks each
//! package's SHA-256, so "Official" is decided here, not by the window.

use super::{install, state};
use crate::app_dirs::AppDirs;
use crate::ext_stats;

mod download;
mod fitting;
pub(crate) mod pages;
pub(crate) mod skills;
use download::{checked, download_counted, fetch, hex};
#[cfg(test)]
use pages::readme_for;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
#[cfg(test)]
use skills::{install_skill_in, SKILL_EXISTS};
use std::sync::Mutex;

/// Where the catalog names its files: the textus-plugins repository's
/// releases. Anything else in it is left out.
const PACKAGE_PREFIX: &str = "https://github.com/CatVinci-Studio/textus-plugins/releases/download/";

/// Where the app reads them: Textus's own site passes each release file on,
/// so the store works where GitHub can't be reached.
const MIRROR_PREFIX: &str = "https://textus.md/plugin-release/";
const CATALOG_URL: &str = "https://textus.md/plugin-release/catalog/index.json";

/// A release file's address on the site; None for one from elsewhere.
fn mirrored(url: &str) -> Option<String> {
    url.strip_prefix(PACKAGE_PREFIX)
        .map(|rest| format!("{MIRROR_PREFIX}{rest}"))
}

/// A package this large is not a plugin.
use super::install::MAX_PACKAGE_BYTES as MAX_PACKAGE;

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
    /// Kept for those who have it (its updates still come) but no longer
    /// offered to install: a plugin merged into another.
    #[serde(default)]
    pub unlisted: bool,
    /// Its earlier versions, newest first, for a Textus the newest needs a
    /// newer one than (fitting.rs).
    #[serde(default)]
    pub versions: Vec<fitting::EarlierVersion>,
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

/// The catalog's address: the published one, or TEXTUS_PLUGIN_CATALOG for
/// testing one before it is published.
fn catalog_url() -> String {
    std::env::var("TEXTUS_PLUGIN_CATALOG").unwrap_or_else(|_| CATALOG_URL.to_string())
}

fn parse_all(text: &str) -> Result<(Vec<CatalogEntry>, Vec<SkillEntry>), String> {
    let catalog: Catalog =
        serde_json::from_str(text).map_err(|e| format!("The plugin catalog can't be read: {e}"))?;
    if catalog.schema != 1 {
        return Err(crate::errors::error("catalogNewer"));
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
            p.versions.retain_mut(|v| match mirrored(&v.url) {
                Some(url) => {
                    v.url = url;
                    true
                }
                None => false,
            });
            Some(fitting::fitted(p, env!("CARGO_PKG_VERSION")))
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

/// The catalog as last fetched, kept in the cache folder so Get plugins can
/// list it at once, even offline.
fn cache_file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    Ok(app
        .path()
        .own_cache_dir()
        .map_err(|e| e.to_string())?
        .join("plugin-catalog.json"))
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
        let _ = crate::atomic::write_sync(&path, text);
    }
    Ok(entries)
}

/// The catalog as last fetched, shown while a fresh one loads. Installing from
/// it is safe: a version's package never changes, so its checksum holds.
#[tauri::command(async)]
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
        update: present
            .as_ref()
            .is_some_and(|v| is_newer(v, &entry.version)),
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
        tauri::async_runtime::spawn_blocking(move || {
            install::install_sync(&app, &package, install::Origin::Catalog)
        })
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

/// Whether `offered` is a later version than `have`, both semver; a version
/// either can't be read as is never newer.
fn is_newer(have: &str, offered: &str) -> bool {
    match (
        semver::Version::parse(have.trim()),
        semver::Version::parse(offered.trim()),
    ) {
        (Ok(have), Ok(offered)) => offered > have,
        _ => false,
    }
}

/// The version of plugin `id` installed in `root`, if one is.
pub(super) fn installed_version(root: &std::path::Path, id: &str) -> Option<String> {
    let text = std::fs::read_to_string(root.join(id).join(super::MANIFEST)).ok()?;
    let manifest: Value = serde_json::from_str(&text).ok()?;
    Some(manifest.get("version")?.as_str()?.to_string())
}

#[cfg(test)]
mod tests;
