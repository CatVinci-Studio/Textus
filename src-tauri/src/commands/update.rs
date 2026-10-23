//! The in-app update check, on the channel chosen in Settings › General ›
//! About Textus (`updateChannel`, src/settings/SettingsContext.tsx).
//!
//!   stable  tauri.conf.json's endpoint: the newest stable GitHub release's
//!           textus-latest.json (never latest.json - see
//!           scripts/updater-manifest.mjs).
//!   beta    textus-beta.json on our own download bucket, which the release
//!           workflow points at the newest release of any kind, release
//!           candidates included: GitHub's `releases/latest` skips
//!           pre-releases, so it can't serve them. The stable endpoint
//!           follows as a fallback, so a bucket outage still leaves beta
//!           users the stable updates.
//!
//! Either way an update must be newer than what is installed, so a beta
//! user who switches back to Stable keeps the release candidate until a
//! newer stable version exists (1.0.5 > 1.0.5-rc.2 in semver).
//!
//! It replaces the JS `check()` of @tauri-apps/plugin-updater, which can't
//! choose endpoints: it answers the same metadata, and the JS `Update`
//! built from it downloads and installs through the plugin's own commands.

use semver::Version;
use serde::Serialize;
use tauri::{Manager, Runtime, Url, Webview};
use tauri_plugin_updater::UpdaterExt;

/// Where the beta channel's manifest lives. The website's
/// functions/download/[[path]].js (CatVinci-Studio/levis-homepage) serves
/// it with a short cache; release.yml uploads it.
pub const BETA_MANIFEST_URL: &str = "https://textus.catvinci.com/download/textus-beta.json";

/// The endpoints to ask, in order, for `channel` ("stable" or "beta"; an
/// unknown value is stable). `configured` is tauri.conf.json's list.
pub fn endpoints_for(channel: &str, configured: &[Url]) -> Vec<Url> {
    let mut endpoints = Vec::new();
    if channel == "beta" {
        endpoints.push(Url::parse(BETA_MANIFEST_URL).expect("valid beta manifest URL"));
    }
    endpoints.extend(configured.iter().cloned());
    endpoints
}

/// Whether `remote` is an update for `current`. Only ever forward: a stable
/// manifest older than the installed release candidate is not offered.
pub fn is_update(current: &Version, remote: &Version) -> bool {
    remote > current
}

/// The manifest key an .rpm install updates from (scripts/updater-manifest.mjs):
/// `linux-x86_64-rpm` or `linux-aarch64-rpm`. On those two architectures
/// `std::env::consts::ARCH` is what tauri-plugin-updater puts in its keys.
fn rpm_platform() -> String {
    format!("linux-{}-rpm", std::env::consts::ARCH)
}

/// Whether a release can update this install. Release candidates have no
/// .rpm (RPM versions can't contain '-'), and without that entry the plugin
/// would hand an .rpm install the AppImage, which it then refuses to
/// install; such an install waits for the stable release instead.
fn serves_install(release: &tauri_plugin_updater::RemoteRelease, rpm_install: bool) -> bool {
    !rpm_install || release.download_url(&rpm_platform()).is_ok()
}

fn is_rpm_install() -> bool {
    cfg!(target_os = "linux")
        && tauri::utils::platform::bundle_type() == Some(tauri::utils::config::BundleType::Rpm)
}

/// The plugin's own check answer (tauri-plugin-updater's commands.rs
/// `Metadata`), which the JS `Update` class is built from
/// (`updater.check` in src/platform/ipc.ts).
#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: tauri::ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

fn configured_endpoints<R: Runtime>(webview: &Webview<R>) -> Vec<Url> {
    webview
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("endpoints"))
        .and_then(|list| list.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|url| url.as_str().and_then(|url| Url::parse(url).ok()))
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn check_for_update<R: Runtime>(
    webview: Webview<R>,
    channel: String,
) -> Result<Option<UpdateMetadata>, String> {
    let endpoints = endpoints_for(&channel, &configured_endpoints(&webview));
    let rpm_install = is_rpm_install();
    let updater = webview
        .updater_builder()
        .endpoints(endpoints)
        .map_err(|e| e.to_string())?
        .version_comparator(move |current, remote| {
            is_update(&current, &remote.version) && serves_install(&remote, rpm_install)
        })
        .build()
        .map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    Ok(Some(UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: update
            .raw_json
            .get("pub_date")
            .and_then(|d| d.as_str())
            .map(str::to_owned),
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    }))
}

/// Just before the relaunch that applies an update: gives up the claim to
/// be the running Textus. The relaunch starts the new process before this
/// one ends, and the single-instance plugin lets go of its claim only on a
/// clean exit - so the new process found it, handed its launch to this one
/// and quit, and this one, about to end, opened a window for it (#349).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn release_instance<R: Runtime>(app: tauri::AppHandle<R>) {
    tauri_plugin_single_instance::destroy(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stable() -> Vec<Url> {
        vec![Url::parse(
            "https://github.com/CatVinci-Studio/Textus/releases/latest/download/textus-latest.json",
        )
        .unwrap()]
    }

    fn v(s: &str) -> Version {
        Version::parse(s).unwrap()
    }

    #[test]
    fn stable_reads_only_the_configured_endpoint() {
        assert_eq!(endpoints_for("stable", &stable()), stable());
    }

    #[test]
    fn an_unknown_channel_is_stable() {
        assert_eq!(endpoints_for("nightly", &stable()), stable());
        assert_eq!(endpoints_for("", &stable()), stable());
    }

    #[test]
    fn beta_reads_the_beta_manifest_then_falls_back_to_stable() {
        let endpoints = endpoints_for("beta", &stable());
        assert_eq!(endpoints[0].as_str(), BETA_MANIFEST_URL);
        assert_eq!(&endpoints[1..], stable().as_slice());
    }

    #[test]
    fn beta_never_names_the_old_apps_manifest() {
        for url in endpoints_for("beta", &stable()) {
            assert_ne!(
                url.path_segments().unwrap().next_back(),
                Some("latest.json")
            );
        }
    }

    #[test]
    fn a_release_candidate_updates_to_its_stable_release() {
        assert!(is_update(&v("1.0.5-rc.2"), &v("1.0.5")));
        assert!(is_update(&v("1.0.5-rc.1"), &v("1.0.5-rc.2")));
        assert!(is_update(&v("1.0.4"), &v("1.0.5-rc.1")));
    }

    fn release(platforms: &[&str]) -> tauri_plugin_updater::RemoteRelease {
        let platforms: serde_json::Map<_, _> = platforms
            .iter()
            .map(|key| {
                (
                    key.to_string(),
                    serde_json::json!({ "url": "https://example.com/a", "signature": "s" }),
                )
            })
            .collect();
        serde_json::from_value(serde_json::json!({
            "version": "1.0.5-rc.1",
            "platforms": platforms,
        }))
        .unwrap()
    }

    #[test]
    fn an_rpm_install_waits_for_a_release_with_an_rpm() {
        // A release candidate: AppImage and .deb only.
        let rc = release(&[
            "linux-x86_64",
            "linux-x86_64-appimage",
            "linux-x86_64-deb",
            "linux-aarch64",
            "linux-aarch64-appimage",
            "linux-aarch64-deb",
        ]);
        assert!(!serves_install(&rc, true));
        assert!(serves_install(&rc, false));
        let stable = release(&[
            "linux-x86_64",
            "linux-x86_64-rpm",
            "linux-aarch64",
            "linux-aarch64-rpm",
        ]);
        assert!(serves_install(&stable, true));
    }

    #[test]
    fn an_rpm_install_looks_for_its_own_architecture() {
        let other = if cfg!(target_arch = "aarch64") {
            "linux-x86_64-rpm"
        } else {
            "linux-aarch64-rpm"
        };
        assert!(!serves_install(&release(&[other]), true));
        assert!(serves_install(&release(&[&rpm_platform()]), true));
    }

    #[test]
    fn switching_back_to_stable_never_downgrades() {
        // On 1.0.5-rc.2, the stable manifest still says 1.0.4.
        assert!(!is_update(&v("1.0.5-rc.2"), &v("1.0.4")));
        assert!(!is_update(&v("1.0.5"), &v("1.0.5")));
        assert!(!is_update(&v("1.0.5"), &v("1.0.5-rc.2")));
    }
}
