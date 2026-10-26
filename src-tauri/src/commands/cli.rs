//! "Install 'textus' command in PATH". macOS only: the script runs
//! `open -a Textus`, which reuses a running instance.

#[cfg(target_os = "macos")]
use crate::app_identity::APP_NAME;

#[cfg(target_os = "macos")]
const CLI_BIN_PATH: &str = "/usr/local/bin/textus";

#[cfg(target_os = "macos")]
fn script_content() -> String {
    format!("#!/bin/bash\nexec open -a \"{APP_NAME}\" \"$@\"\n")
}

#[cfg(target_os = "macos")]
fn write_direct() -> std::io::Result<()> {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    fs::write(CLI_BIN_PATH, script_content())?;
    fs::set_permissions(CLI_BIN_PATH, fs::Permissions::from_mode(0o755))?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn is_installed() -> bool {
    std::fs::read_to_string(CLI_BIN_PATH)
        .map(|c| c == script_content())
        .unwrap_or(false)
}

/// Called once on startup: installs quietly when `/usr/local/bin` is
/// user-writable, and otherwise does nothing rather than prompt for a password.
#[cfg(target_os = "macos")]
pub fn try_silent_install() {
    if !is_installed() {
        let _ = write_direct();
    }
}

#[cfg(target_os = "macos")]
pub fn install() -> Result<(), String> {
    if write_direct().is_ok() {
        return Ok(());
    }
    // Root-owned /usr/local/bin: stage the script in a fresh owner-only temp
    // file and have an admin shell copy it, so AppleScript only quotes paths.
    let tmp = crate::atomic::TempFile::create("textus-cli-install-", "", script_content())
        .map_err(|e| e.to_string())?;
    let shell_cmd = format!(
        "mkdir -p /usr/local/bin && cp '{}' '{CLI_BIN_PATH}' && chmod 755 '{CLI_BIN_PATH}'",
        tmp.path().display()
    );
    let escaped = shell_cmd.replace('\\', "\\\\").replace('"', "\\\"");
    let apple_script = format!(
        "do shell script \"{escaped}\" with administrator privileges with prompt \
         \"{APP_NAME} wants to install the 'textus' command in /usr/local/bin.\""
    );
    let result = std::process::Command::new("osascript")
        .arg("-e")
        .arg(apple_script)
        .output();
    drop(tmp);
    let output = result.map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("User canceled") {
            Err("Cancelled.".to_string())
        } else {
            Err(stderr.trim().to_string())
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn is_installed() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn try_silent_install() {}

#[cfg(not(target_os = "macos"))]
pub fn install() -> Result<(), String> {
    Err("Installing the 'textus' command is only supported on macOS.".into())
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn cli_command_status() -> bool {
    is_installed()
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn install_cli_command() -> Result<(), String> {
    install()
}
