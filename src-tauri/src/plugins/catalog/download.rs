//! Talking to the release host: the HTTP client and the hosts its redirects
//! may reach, a second try for a dropped connection, the catalog's text,
//! downloads (counted when counts are on) and the checksum each is held to.

use super::{catalog_url, CatalogEntry};
use crate::ext_stats;
use sha2::{Digest, Sha256};

/// The most the catalog's index may be.
const MAX_CATALOG_BYTES: usize = 8 * 1024 * 1024;

/// The site's address, and the one it had before (which still serves).
const DOWNLOAD_HOSTS: [&str; 2] = ["textus.md", "textus.catvinci.com"];

pub(super) fn download_host(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some_and(|h| DOWNLOAD_HOSTS.contains(&h))
}

pub(super) fn client() -> Result<reqwest::Client, String> {
    client_with(reqwest::redirect::Policy::custom(|attempt| {
        if download_host(attempt.url()) && attempt.previous().len() < 5 {
            attempt.follow()
        } else {
            attempt.stop()
        }
    }))
}

pub(super) fn client_with(redirects: reqwest::redirect::Policy) -> Result<reqwest::Client, String> {
    use std::time::Duration;
    // Connecting gives up soon, so an unreachable counting endpoint falls
    // back quickly.
    crate::net::public_client(Duration::from_secs(10), Duration::from_secs(120))?
        .user_agent(crate::app_identity::APP_NAME)
        .redirect(redirects)
        .build()
        .map_err(|e| e.to_string())
}

/// Fetches the catalog's text from its address.
pub(super) async fn fetch() -> Result<String, String> {
    let url = catalog_url();
    if let Some(path) = url.strip_prefix("file://") {
        return std::fs::read_to_string(path).map_err(|e| e.to_string());
    }
    let client = client()?;
    twice(|| async {
        let response = client.get(&url).send().await.map_err(|e| {
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
        let body = crate::net::read_limited(response, MAX_CATALOG_BYTES)
            .await
            .map_err(|e| format!("The plugin catalog broke off: {e}"))?
            .ok_or_else(|| "The plugin catalog is too large to read.".to_string())?;
        String::from_utf8(body).map_err(|e| e.to_string())
    })
    .await
}

/// A slow or dropped connection often holds on a second try.
async fn twice<T, F, Fut>(attempt: F) -> Result<T, String>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    match attempt().await {
        Ok(value) => Ok(value),
        Err(_) => attempt().await,
    }
}

/// Whether `bytes` is the package the catalog describes.
pub(super) fn checked(entry: &CatalogEntry, bytes: &[u8]) -> Result<(), String> {
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

pub(super) use crate::ids::hex;

/// Downloads `url` from the catalog's own address.
pub(super) async fn download(url: &str, what: &str) -> Result<Vec<u8>, String> {
    download_with(client()?, url, what).await
}

/// Downloads a package, through the counting endpoint when counts are on.
pub(super) async fn download_counted(
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

pub(super) async fn download_with(
    client: reqwest::Client,
    url: &str,
    what: &str,
) -> Result<Vec<u8>, String> {
    if let Some(path) = url.strip_prefix("file://") {
        return std::fs::read(path).map_err(|e| e.to_string());
    }
    twice(|| async {
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
        crate::net::read_limited(response, super::MAX_PACKAGE as usize)
            .await
            .map_err(|e| format!("The download of {what} broke off: {e}"))?
            .ok_or_else(|| format!("The download of {what} is too large."))
    })
    .await
}
