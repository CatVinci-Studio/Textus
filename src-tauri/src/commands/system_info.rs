//! What a problem report says Textus runs on (Help > Report a Problem).

use serde::Serialize;

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
    let Ok(key) = windows_registry::LOCAL_MACHINE
        .open(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
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
