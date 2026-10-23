//! The plugins Textus offers to install (Settings › Plugins › Get plugins):
//! the catalog published with CatVinci-Studio/textus-plugins, and
//! installing one from it. No plugin comes with Textus; each is downloaded
//! when the user asks for it.
//!
//! Only Rust fetches the catalog and the packages, from fixed addresses,
//! and checks each package against the catalog's SHA-256 before it
//! installs it - so whether a plugin is CatVinci's own (Settings marks it
//! Official) is decided here, from where it came, not by the window.

use super::{install, state};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::Mutex;

/// The catalog, rebuilt by textus-plugins' release workflow.
const CATALOG_URL: &str =
    "https://github.com/CatVinci-Studio/textus-plugins/releases/download/catalog/index.json";

/// Where packages may come from: that repository's releases (GitHub sends
/// the download on to its own storage, which the redirect may reach).
const PACKAGE_PREFIX: &str = "https://github.com/CatVinci-Studio/textus-plugins/releases/download/";
const DOWNLOAD_HOSTS: [&str; 3] = [
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
];

/// A package this large is not a plugin.
const MAX_PACKAGE: u64 = 200 * 1024 * 1024;

/// One plugin in the catalog - generated into
/// src/platform/bindings/plugins.ts (src/plugins/catalog.ts reads it).
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
}

#[derive(Deserialize)]
struct Catalog {
    schema: u32,
    plugins: Vec<CatalogEntry>,
}

/// The catalog as last fetched, for an install to take its entry from.
static FETCHED: Mutex<Vec<CatalogEntry>> = Mutex::new(Vec::new());

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

/// The catalog's address: the published one, or - for testing a catalog
/// before it is published - TEXTUS_PLUGIN_CATALOG.
fn catalog_url() -> String {
    std::env::var("TEXTUS_PLUGIN_CATALOG").unwrap_or_else(|_| CATALOG_URL.to_string())
}

fn parse(text: &str) -> Result<Vec<CatalogEntry>, String> {
    let catalog: Catalog =
        serde_json::from_str(text).map_err(|e| format!("The plugin catalog can't be read: {e}"))?;
    if catalog.schema != 1 {
        return Err("The plugin catalog is for a newer Textus - update Textus to see it.".into());
    }
    Ok(catalog
        .plugins
        .into_iter()
        .filter(|p| super::require_id(&p.id).is_ok() && p.url.starts_with(PACKAGE_PREFIX))
        .collect())
}

/// The catalog, fetched now.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_catalog() -> Result<Vec<CatalogEntry>, String> {
    let url = catalog_url();
    let text = if let Some(path) = url.strip_prefix("file://") {
        std::fs::read_to_string(path).map_err(|e| e.to_string())?
    } else {
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
        response.text().await.map_err(|e| e.to_string())?
    };
    let entries = parse(&text)?;
    *FETCHED.lock().unwrap_or_else(|e| e.into_inner()) = entries.clone();
    Ok(entries)
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

/// Installs `id` from the catalog last fetched: downloads its package,
/// checks it, and installs it as a package from a file is - marked
/// Official when the catalog says it is CatVinci's.
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
    let bytes = if let Some(path) = entry.url.strip_prefix("file://") {
        std::fs::read(path).map_err(|e| e.to_string())?
    } else {
        let response = client()?
            .get(&entry.url)
            .send()
            .await
            .map_err(|e| format!("Couldn't download {id}: {e}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "The download of {id} answered {}.",
                response.status()
            ));
        }
        response.bytes().await.map_err(|e| e.to_string())?.to_vec()
    };
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

    fn entry(bytes: &[u8]) -> CatalogEntry {
        CatalogEntry {
            id: "catvinci.tasks".into(),
            version: "1.0.0".into(),
            official: true,
            manifest: Value::Null,
            url: format!("{PACKAGE_PREFIX}catvinci.tasks-v1.0.0/catvinci.tasks-1.0.0.zip"),
            sha256: hex(&Sha256::digest(bytes)),
            size: bytes.len() as u64,
        }
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

    /// The published catalog, and one package from it, through the same
    /// client and checks an install uses. Run with `--ignored`; it needs
    /// the network.
    #[test]
    #[ignore = "network: the published catalog"]
    fn the_published_catalog_and_its_packages_check_out() {
        tauri::async_runtime::block_on(async {
            let entries = plugin_catalog().await.expect("the catalog");
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
