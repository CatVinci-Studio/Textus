//! Anonymous install counts for plugins, themes and skills
//! (services/ext-stats). A download goes through the counting endpoint,
//! which redirects to the package; an uninstall is posted to it. Nothing
//! names the device: only the extension, the event, the OS and the app's
//! version. Settings › Privacy turns it off (`anonymousStats`); then, or when
//! the endpoint fails, the package is downloaded straight from its address.

use reqwest::redirect::Policy;
use reqwest::Url;
use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const ENDPOINT: &str = "https://textus.catvinci.com/api/ext/";
const SETTING: &str = "anonymousStats";
/// Which extensions were ever installed on this device, so a second install
/// counts as a reinstall. Kept in app data, never synced.
const RECORD: &str = "ext-installed.json";

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Plugin,
    Theme,
    Skill,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::Plugin => "plugin",
            Kind::Theme => "theme",
            Kind::Skill => "skill",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Event {
    Install,
    Reinstall,
    Update,
    Uninstall,
}

impl Event {
    fn name(self) -> &'static str {
        match self {
            Event::Install => "install",
            Event::Reinstall => "reinstall",
            Event::Update => "update",
            Event::Uninstall => "uninstall",
        }
    }
}

/// One download to count.
pub struct Download<'a> {
    pub kind: Kind,
    pub id: &'a str,
    pub version: &'a str,
    /// It replaces an older version installed now.
    pub update: bool,
    /// A copy is installed now (the same version, or an older one).
    pub present: bool,
    /// The package's own address, where the endpoint redirects to.
    pub direct: &'a str,
}

/// The endpoint: TEXTUS_EXT_STATS for trying a local one; a debug build
/// counts only there, so development never adds to the real counts.
fn endpoint() -> Option<String> {
    match std::env::var("TEXTUS_EXT_STATS") {
        Ok(url) => Some(url),
        Err(_) if cfg!(debug_assertions) => None,
        Err(_) => Some(ENDPOINT.to_string()),
    }
}

fn enabled(app: &AppHandle) -> bool {
    crate::settings::read_setting(app, SETTING)
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

fn os() -> &'static str {
    match std::env::consts::OS {
        "macos" => "mac",
        other => other,
    }
}

fn event_for(update: bool, before: bool) -> Event {
    if update {
        Event::Update
    } else if before {
        Event::Reinstall
    } else {
        Event::Install
    }
}

pub(crate) fn download_url(base: &str, d: &Download, event: Event) -> Option<String> {
    let mut url = Url::parse(base).ok()?.join("download").ok()?;
    url.query_pairs_mut()
        .append_pair("kind", d.kind.name())
        .append_pair("id", d.id)
        .append_pair("version", d.version)
        .append_pair("event", event.name())
        .append_pair("os", os())
        .append_pair("app", env!("CARGO_PKG_VERSION"));
    // A theme's stylesheet may be named otherwise.
    if d.kind == Kind::Theme {
        let file = d.direct.rsplit('/').next().unwrap_or_default();
        url.query_pairs_mut().append_pair("file", file);
    }
    Some(url.into())
}

/// Where to download `d` from to count it; None when counts are off, or for
/// a package that isn't on the web (a test catalog's file:// one).
pub fn counted_url(app: &AppHandle, d: &Download) -> Option<String> {
    if !d.direct.starts_with("https://") || !enabled(app) {
        return None;
    }
    let before = d.present || record_file(app).is_some_and(|f| seen_in(&f, d.kind, d.id));
    download_url(&endpoint()?, d, event_for(d.update, before))
}

/// Errs for an answer from the endpoint itself rather than the package it
/// redirects to (a page where no endpoint is deployed, say).
pub fn check_redirected(response: &reqwest::Response) -> Result<(), String> {
    match endpoint() {
        Some(base) if is_endpoint(response.url(), &base) => {
            Err("the install counter didn't redirect".into())
        }
        _ => Ok(()),
    }
}

fn is_endpoint(url: &Url, base: &str) -> bool {
    url.as_str().starts_with(base)
}

/// The result of `get` from `counted`, or from `direct` when there is no
/// counted address or it failed: counting never stops an install.
pub async fn counted_or_direct<T, F, Fut>(
    counted: Option<String>,
    direct: &str,
    get: F,
) -> Result<T, String>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    if let Some(url) = counted {
        if let Ok(found) = get(url).await {
            return Ok(found);
        }
    }
    get(direct.to_string()).await
}

/// Whether a redirect to `next` is followed: from the endpoint `base` only
/// to `direct`, the package asked for; anywhere else as `then` allows.
fn may_follow(
    previous: &[Url],
    next: &Url,
    direct: &str,
    base: Option<&str>,
    then: fn(&Url) -> bool,
) -> bool {
    let from_endpoint = previous
        .last()
        .zip(base)
        .is_some_and(|(from, base)| is_endpoint(from, base));
    previous.len() < 5
        && if from_endpoint {
            next.as_str() == direct
        } else {
            then(next)
        }
}

/// A redirect policy for downloading `direct`, perhaps through the endpoint.
pub fn redirects(direct: &str, then: fn(&Url) -> bool) -> Policy {
    let direct = direct.to_string();
    let base = endpoint();
    Policy::custom(move |attempt| {
        if may_follow(
            attempt.previous(),
            attempt.url(),
            &direct,
            base.as_deref(),
            then,
        ) {
            attempt.follow()
        } else {
            attempt.stop()
        }
    })
}

/// Notes `id` as installed on this device. Kept whether counts are on or not:
/// it never leaves the device.
pub fn installed(app: &AppHandle, kind: Kind, id: &str) {
    if let Some(file) = record_file(app) {
        remember_in(&file, kind, id);
    }
}

/// Counts an uninstall, in the background; nothing waits for it.
pub fn uninstalled(app: &AppHandle, kind: Kind, id: &str, version: &str) {
    installed(app, kind, id);
    let Some(url) = endpoint().and_then(|base| Url::parse(&base).ok()?.join("event").ok()) else {
        return;
    };
    if !enabled(app) {
        return;
    }
    let body = serde_json::json!({
        "kind": kind.name(),
        "id": id,
        "version": version,
        "event": Event::Uninstall.name(),
        "os": os(),
        "app": env!("CARGO_PKG_VERSION"),
    });
    tauri::async_runtime::spawn(async move {
        let timeout = std::time::Duration::from_secs(10);
        if let Ok(client) = crate::net::client(timeout, timeout).build() {
            let _ = client.post(url).json(&body).send().await;
        }
    });
}

fn record_file(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_data_dir().ok()?.join(RECORD))
}

type Record = BTreeMap<String, BTreeSet<String>>;

fn read_record(file: &Path) -> Record {
    std::fs::read_to_string(file)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn seen_in(file: &Path, kind: Kind, id: &str) -> bool {
    read_record(file)
        .get(kind.name())
        .is_some_and(|ids| ids.contains(id))
}

fn remember_in(file: &Path, kind: Kind, id: &str) {
    let mut record = read_record(file);
    if record
        .entry(kind.name().to_string())
        .or_default()
        .insert(id.to_string())
    {
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        // Only a hint: a record that can't be written makes a later install
        // count as a first one.
        let _ = std::fs::write(file, serde_json::to_string(&record).unwrap_or_default());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIRECT: &str = "https://github.com/CatVinci-Studio/textus-plugins/releases/download/a.b-v1.0.0/a.b-1.0.0.zip";

    fn plugin() -> Download<'static> {
        Download {
            kind: Kind::Plugin,
            id: "a.b",
            version: "1.0.0",
            update: false,
            present: false,
            direct: DIRECT,
        }
    }

    #[test]
    fn the_first_install_on_a_device_is_an_install_then_a_reinstall_an_update_an_update() {
        assert_eq!(event_for(false, false), Event::Install);
        assert_eq!(event_for(false, true), Event::Reinstall);
        assert_eq!(event_for(true, true), Event::Update);
    }

    #[test]
    fn the_record_remembers_each_kind_s_ids_apart() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sub").join(RECORD);
        assert!(!seen_in(&file, Kind::Plugin, "a.b"));
        remember_in(&file, Kind::Plugin, "a.b");
        remember_in(&file, Kind::Plugin, "a.b");
        assert!(seen_in(&file, Kind::Plugin, "a.b"));
        assert!(!seen_in(&file, Kind::Theme, "a.b"));
        std::fs::write(&file, "not json").unwrap();
        assert!(!seen_in(&file, Kind::Plugin, "a.b"));
    }

    #[test]
    fn a_counted_download_names_the_extension_event_os_and_app_and_nothing_else() {
        let url = download_url(ENDPOINT, &plugin(), Event::Install).unwrap();
        let url = Url::parse(&url).unwrap();
        assert_eq!(
            url.as_str().split('?').next(),
            Some("https://textus.catvinci.com/api/ext/download")
        );
        let fields: BTreeMap<String, String> = url.query_pairs().into_owned().collect();
        assert_eq!(
            fields.keys().collect::<Vec<_>>(),
            ["app", "event", "id", "kind", "os", "version"]
        );
        assert_eq!(fields["kind"], "plugin");
        assert_eq!(fields["event"], "install");
        assert_eq!(fields["app"], env!("CARGO_PKG_VERSION"));
        let theme = Download {
            kind: Kind::Theme,
            id: "plain",
            version: "2026-10-18T04:55:06Z",
            direct: "https://raw.githubusercontent.com/CatVinci-Studio/textus-themes/main/themes/plain/theme.css",
            ..plugin()
        };
        let url = download_url(ENDPOINT, &theme, Event::Update).unwrap();
        assert!(url.contains("file=theme.css"), "{url}");
        assert!(url.contains("version=2026-10-18T04%3A55%3A06Z"), "{url}");
    }

    #[test]
    fn from_the_endpoint_only_the_package_asked_for_is_followed() {
        let base = Some(ENDPOINT);
        let from = [Url::parse(&format!("{ENDPOINT}download?id=a.b")).unwrap()];
        let elsewhere = |_: &Url| false;
        assert!(may_follow(
            &from,
            &Url::parse(DIRECT).unwrap(),
            DIRECT,
            base,
            elsewhere
        ));
        let other =
            Url::parse("https://github.com/someone/else/releases/download/x/x.zip").unwrap();
        assert!(!may_follow(&from, &other, DIRECT, base, |_| true));
        // GitHub's own redirect onwards is the caller's to judge.
        let github = [Url::parse(DIRECT).unwrap()];
        assert!(may_follow(&github, &other, DIRECT, base, |_| true));
        assert!(!may_follow(&github, &other, DIRECT, base, elsewhere));
    }

    #[test]
    fn only_a_redirected_answer_is_the_package() {
        let at = |url: &str| is_endpoint(&Url::parse(url).unwrap(), ENDPOINT);
        assert!(at(
            "https://textus.catvinci.com/api/ext/download?kind=plugin"
        ));
        assert!(!at(DIRECT));
        assert!(!at("https://textus.catvinci.com/download"));
    }

    #[test]
    fn an_endpoint_that_fails_falls_back_to_the_package_s_own_address() {
        let got = |counted: Option<&str>, fails: &'static str| {
            let counted = counted.map(str::to_string);
            tauri::async_runtime::block_on(counted_or_direct(counted, DIRECT, |url| async move {
                if url == fails {
                    Err("unreachable".to_string())
                } else {
                    Ok(url)
                }
            }))
        };
        assert_eq!(got(Some("https://counted"), "").unwrap(), "https://counted");
        assert_eq!(
            got(Some("https://counted"), "https://counted").unwrap(),
            DIRECT
        );
        assert_eq!(got(None, "").unwrap(), DIRECT);
        assert!(got(None, DIRECT).is_err());
    }
}
