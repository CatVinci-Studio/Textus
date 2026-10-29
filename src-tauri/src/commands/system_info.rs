//! Help > Report a Problem: what Textus runs on, and sending the report.

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// The Worker that files a report as a GitHub issue (services/feedback).
const FEEDBACK_URL: &str = "https://textus.catvinci.com/api/feedback";

#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct SystemInfo {
    /// The system and its version: "macOS 26.1", "Windows 11 24H2 (26100)".
    pub os: String,
    pub arch: String,
    /// The webview's own version: WebKit's, WebView2's or WebKitGTK's.
    pub webview: String,
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn system_info() -> SystemInfo {
    SystemInfo {
        os: os_version(),
        arch: std::env::consts::ARCH.to_string(),
        webview: tauri::webview_version().unwrap_or_default(),
    }
}

/// A report as services/feedback/issue.ts reads it.
#[derive(Serialize, Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct ProblemReport {
    pub kind: String,
    pub area: String,
    pub severity: Option<String>,
    pub description: String,
    pub details: String,
    pub contact: Option<String>,
    pub version: String,
    pub language: String,
}

/// The issue a report became.
#[derive(Serialize, Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct SentReport {
    pub url: String,
    pub number: u32,
}

/// Files `report`. "LIMIT" when this computer has sent its share today;
/// otherwise the connection's or the service's error.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn send_problem_report(report: ProblemReport) -> Result<SentReport, String> {
    let client = crate::net::client(Duration::from_secs(10), Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(FEEDBACK_URL)
        .json(&report)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    match response.status().as_u16() {
        201 => response.json().await.map_err(|e| e.to_string()),
        429 => Err("LIMIT".into()),
        status => Err(format!("The feedback service answered {status}.")),
    }
}

#[cfg(target_os = "macos")]
fn os_version() -> String {
    use objc2_foundation::NSProcessInfo;
    // "Version 26.1 (Build 25B78)".
    let version = NSProcessInfo::processInfo()
        .operatingSystemVersionString()
        .to_string();
    format!("macOS {}", version.trim_start_matches("Version "))
}

#[cfg(windows)]
fn os_version() -> String {
    let Ok(key) =
        windows_registry::LOCAL_MACHINE.open(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
    else {
        return "Windows".into();
    };
    let build = key.get_string("CurrentBuild").unwrap_or_default();
    let release = key.get_string("DisplayVersion").unwrap_or_default();
    // Windows 11 still names itself Windows 10 here; its builds start at 22000.
    let name = if build.parse::<u32>().unwrap_or(0) >= 22000 {
        "Windows 11"
    } else {
        "Windows 10"
    };
    format!("{name} {release} ({build})")
}

#[cfg(target_os = "linux")]
fn os_version() -> String {
    let release = std::fs::read_to_string("/etc/os-release").unwrap_or_default();
    let name = release
        .lines()
        .find_map(|line| line.strip_prefix("PRETTY_NAME="))
        .map(|name| name.trim_matches('"').to_string())
        .unwrap_or_else(|| "Linux".into());
    match std::env::var("XDG_CURRENT_DESKTOP") {
        Ok(desktop) if !desktop.is_empty() => format!("{name} {desktop}"),
        _ => name,
    }
}

#[cfg(target_os = "ios")]
fn os_version() -> String {
    "iOS".into()
}
