//! The plugins Textus offers to install, from the textus-plugins catalog. Only
//! Rust fetches the catalog and packages, from fixed addresses, and checks each
//! package's SHA-256, so "Official" is decided here, not by the window.

use super::{install, state};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::Mutex;

/// The catalog's published address.
const CATALOG_URL: &str =
    "https://github.com/CatVinci-Studio/textus-plugins/releases/download/catalog/index.json";

/// Where packages may come from: that repository's releases (GitHub redirects
/// to its own storage).
const PACKAGE_PREFIX: &str = "https://github.com/CatVinci-Studio/textus-plugins/releases/download/";
const DOWNLOAD_HOSTS: [&str; 3] = [
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
];

/// A package this large is not a plugin.
const MAX_PACKAGE: u64 = 200 * 1024 * 1024;

/// One plugin in the catalog.
#[derive(Serialize, Deserialize, Clone, Debug)]
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

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(crate::app_identity::APP_NAME)
        .timeout(std::time::Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let allowed = attempt.url().scheme() == "https"
                && attempt
                    .url()
                    .host_str()
                    .is_some_and(|h| DOWNLOAD_HOSTS.contains(&h));
            if allowed && attempt.previous().len() < 5 {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
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
        .filter(|p| super::require_id(&p.id).is_ok() && p.url.starts_with(PACKAGE_PREFIX))
        .map(|mut p| {
            p.screenshots.retain(|url| url.starts_with(PACKAGE_PREFIX));
            p
        })
        .collect();
    let skills = catalog
        .skills
        .into_iter()
        .filter(|s| {
            !s.name.trim().is_empty() && s.url.starts_with(PACKAGE_PREFIX) && s.size <= MAX_SKILL
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
    let response = client()?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the plugin catalog: {e}"))?;
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
    if let Some(path) = url.strip_prefix("file://") {
        return std::fs::read(path).map_err(|e| e.to_string());
    }
    let response = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Couldn't download {what}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "The download of {what} answered {}.",
            response.status()
        ));
    }
    Ok(response.bytes().await.map_err(|e| e.to_string())?.to_vec())
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
    let bytes = download(&entry.url, &name).await?;
    if bytes.len() as u64 != entry.size
        || !hex(&Sha256::digest(&bytes)).eq_ignore_ascii_case(&entry.sha256)
    {
        return Err(format!(
            "The download of {name} isn't the file the catalog lists - it was not installed."
        ));
    }
    let text = String::from_utf8(bytes).map_err(|_| format!("{name} isn't a skill file."))?;
    install_skill_in(
        &crate::ai::workspace::global_agent_dir(&app)?.join("skills"),
        &entry.name,
        &text,
    )
    .map(|p| p.to_string_lossy().into_owned())
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
    let bytes = download(&entry.url, &id).await?;
    checked(&entry, &bytes)?;
    let root = super::plugins_root(&app)?;
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
    Ok(installed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalog_lists_skills_beside_plugins_and_an_older_one_none() {
        let url = format!("{PACKAGE_PREFIX}catalog/skill-press-release.md");
        let text = format!(
            r#"{{"schema": 1, "plugins": [], "skills": [{{"name": "press-release", "version": "1.0.0", "description": "Writes a press release.", "url": "{url}", "sha256": "ab", "size": 10}}, {{"name": "elsewhere", "version": "1", "description": "x", "url": "https://example.com/x.md", "sha256": "ab", "size": 10}}]}}"#
        );
        let (_, skills) = parse_all(&text).unwrap();
        assert_eq!(skills.len(), 1, "only from the catalog's own address");
        assert_eq!(skills[0].name, "press-release");
        let (_, none) = parse_all(r#"{"schema": 1, "plugins": []}"#).unwrap();
        assert!(none.is_empty());
    }

    #[test]
    fn a_skill_installs_once_and_never_over_one_there() {
        let dir = tempfile::tempdir().unwrap();
        let text = "---\nname: press-release\ndescription: Writes a press release.\n---\n\nWrite it as a press release.";
        let path = install_skill_in(dir.path(), "press-release", text).unwrap();
        assert!(path.exists());
        assert_eq!(
            install_skill_in(dir.path(), "press-release", text).unwrap_err(),
            SKILL_EXISTS
        );
        assert!(install_skill_in(dir.path(), "empty", "---\nname: empty\n---\n").is_err());
    }

    fn entry(bytes: &[u8]) -> CatalogEntry {
        CatalogEntry {
            id: "catvinci.tasks".into(),
            version: "1.0.0".into(),
            official: true,
            manifest: Value::Null,
            url: format!("{PACKAGE_PREFIX}catvinci.tasks-v1.0.0/catvinci.tasks-1.0.0.zip"),
            sha256: hex(&Sha256::digest(bytes)),
            size: bytes.len() as u64,
            screenshots: Vec::new(),
        }
    }

    #[test]
    fn a_screenshot_from_anywhere_else_is_left_out() {
        let text = format!(
            r#"{{"schema": 1, "plugins": [{{"id": "catvinci.tasks", "version": "1.0.0", "manifest": null, "url": "{PACKAGE_PREFIX}t/t.zip", "sha256": "ab", "size": 1, "screenshots": ["{PACKAGE_PREFIX}catalog/shot-catvinci.tasks-1.png", "https://example.com/x.png"]}}]}}"#
        );
        let (plugins, _) = parse_all(&text).unwrap();
        assert_eq!(
            plugins[0].screenshots,
            vec![format!("{PACKAGE_PREFIX}catalog/shot-catvinci.tasks-1.png")]
        );
    }

    #[test]
    fn a_package_must_be_the_one_the_catalog_lists() {
        let good = b"the package";
        assert!(checked(&entry(good), good).is_ok());
        assert!(checked(&entry(good), b"the packagE")
            .unwrap_err()
            .contains("isn't the package"));
        assert!(checked(&entry(good), b"short")
            .unwrap_err()
            .contains("bytes"));
    }

    /// The published catalog, and one package from it, through the same checks an
    /// install uses. Needs the network.
    #[test]
    #[ignore = "network: the published catalog"]
    fn the_published_catalog_and_its_packages_check_out() {
        tauri::async_runtime::block_on(async {
            let entries = parse(&fetch().await.expect("the catalog")).expect("readable");
            assert!(entries.len() >= 11, "{} plugins", entries.len());
            let tasks = entries.iter().find(|e| e.id == "catvinci.tasks").unwrap();
            assert!(tasks.official);
            let bytes = client()
                .unwrap()
                .get(&tasks.url)
                .send()
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap();
            checked(tasks, &bytes).expect("the package the catalog lists");
        });
    }

    #[test]
    fn the_catalog_keeps_only_packages_from_its_own_releases() {
        let text = serde_json::json!({
            "schema": 1,
            "plugins": [
                {"id": "catvinci.tasks", "version": "1.0.0", "official": true, "manifest": {},
                 "url": format!("{PACKAGE_PREFIX}catvinci.tasks-v1.0.0/a.zip"), "sha256": "00", "size": 1},
                {"id": "someone.else", "version": "1.0.0", "manifest": {},
                 "url": "https://example.com/else.zip", "sha256": "00", "size": 1},
                {"id": "../escape", "version": "1.0.0", "manifest": {},
                 "url": format!("{PACKAGE_PREFIX}x/x.zip"), "sha256": "00", "size": 1}
            ]
        })
        .to_string();
        let entries = parse(&text).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "catvinci.tasks");
        assert!(parse(r#"{"schema": 2, "plugins": []}"#)
            .unwrap_err()
            .contains("newer Textus"));
    }
}
