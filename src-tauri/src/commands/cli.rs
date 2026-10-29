//! The `textus` terminal command. Each platform's script hands its arguments
//! to Textus and returns at once; a running Textus takes them itself.
//! - macOS: `/usr/local/bin/textus` runs `open -a Textus`.
//! - Windows: `bin\textus.cmd` beside the app, that folder on the user's PATH.
//! - Linux: the .deb/.rpm already ship `/usr/bin/textus`; otherwise (the
//!   AppImage) `~/.local/bin/textus`.
//!
//! Startup installs it quietly where no password is needed; Settings ›
//! General retries.

#[cfg(target_os = "macos")]
mod imp {
    use crate::app_identity::APP_NAME;

    const CLI_BIN_PATH: &str = "/usr/local/bin/textus";

    fn script_content() -> String {
        format!("#!/bin/bash\nexec open -a \"{APP_NAME}\" \"$@\"\n")
    }

    fn write_direct() -> std::io::Result<()> {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;
        fs::write(CLI_BIN_PATH, script_content())?;
        fs::set_permissions(CLI_BIN_PATH, fs::Permissions::from_mode(0o755))?;
        Ok(())
    }

    pub fn is_installed() -> bool {
        std::fs::read_to_string(CLI_BIN_PATH)
            .map(|c| c == script_content())
            .unwrap_or(false)
    }

    /// Installs only when `/usr/local/bin` is user-writable, rather than
    /// prompt for a password at startup.
    pub fn try_silent_install() {
        if !is_installed() {
            let _ = write_direct();
        }
    }

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
}

/// `textus.cmd`: `start` returns at once; `%~dp0..` keeps it working when
/// the install folder moves.
#[cfg(any(windows, test))]
fn windows_script(exe_name: &str) -> String {
    format!("@echo off\r\nstart \"\" \"%~dp0..\\{exe_name}\" %*\r\n")
}

/// Whether a `;`-separated PATH holds `dir`, compared as Windows does.
#[cfg(any(windows, test))]
fn path_has(path: &str, dir: &str) -> bool {
    let norm = |s: &str| s.trim().trim_end_matches('\\').to_lowercase();
    path.split(';').any(|p| norm(p) == norm(dir))
}

#[cfg(any(windows, test))]
fn path_with(path: &str, dir: &str) -> String {
    match path.trim_end_matches(';') {
        "" => dir.to_string(),
        rest => format!("{rest};{dir}"),
    }
}

#[cfg(windows)]
mod imp {
    use std::path::PathBuf;
    use windows_registry::{Type, CURRENT_USER};

    const ENV_KEY: &str = "Environment";

    /// The app's folder and its `bin` folder.
    fn paths() -> Result<(String, PathBuf), String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let name = exe
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("No app path.")?
            .to_string();
        let bin = exe.parent().ok_or("No app folder.")?.join("bin");
        Ok((name, bin))
    }

    fn user_path() -> (String, Type) {
        let Ok(key) = CURRENT_USER.open(ENV_KEY) else {
            return (String::new(), Type::ExpandString);
        };
        let ty = key.get_type("Path").unwrap_or(Type::ExpandString);
        (key.get_string("Path").unwrap_or_default(), ty)
    }

    pub fn is_installed() -> bool {
        let Ok((name, bin)) = paths() else {
            return false;
        };
        let script = std::fs::read_to_string(bin.join("textus.cmd")).unwrap_or_default();
        script == super::windows_script(&name)
            && super::path_has(&user_path().0, &bin.to_string_lossy())
    }

    pub fn try_silent_install() {
        if !is_installed() {
            let _ = install();
        }
    }

    pub fn install() -> Result<(), String> {
        let (name, bin) = paths()?;
        std::fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
        std::fs::write(bin.join("textus.cmd"), super::windows_script(&name))
            .map_err(|e| e.to_string())?;
        let dir = bin.to_string_lossy();
        let (path, ty) = user_path();
        if super::path_has(&path, &dir) {
            return Ok(());
        }
        let key = CURRENT_USER.create(ENV_KEY).map_err(|e| e.to_string())?;
        let next = super::path_with(&path, &dir);
        match ty {
            Type::String => key.set_string("Path", &next),
            _ => key.set_expand_string("Path", &next),
        }
        .map_err(|e| e.to_string())?;
        // New terminals opened from Explorer read PATH again on this; a
        // window that doesn't answer could hold it for seconds.
        std::thread::spawn(announce_environment);
        Ok(())
    }

    fn announce_environment() {
        use windows::core::w;
        use windows::Win32::Foundation::{LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
        };
        unsafe {
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                WPARAM(0),
                LPARAM(w!("Environment").as_ptr() as isize),
                SMTO_ABORTIFHUNG,
                5000,
                None,
            );
        }
    }
}

/// `sh` script for `~/.local/bin/textus`, the app detached from the terminal.
#[cfg(any(target_os = "linux", test))]
fn linux_script(app: &str) -> String {
    let quoted = app.replace('\'', "'\\''");
    format!("#!/bin/sh\nexec setsid -f '{quoted}' \"$@\" >/dev/null 2>&1\n")
}

#[cfg(target_os = "linux")]
mod imp {
    use std::path::PathBuf;

    const PACKAGED: &str = "/usr/bin/textus";

    /// The AppImage, or the binary itself.
    fn app() -> Option<String> {
        std::env::var("APPIMAGE")
            .ok()
            .or_else(|| Some(std::env::current_exe().ok()?.to_string_lossy().into_owned()))
    }

    fn script_path() -> Option<PathBuf> {
        Some(PathBuf::from(std::env::var_os("HOME")?).join(".local/bin/textus"))
    }

    fn packaged() -> bool {
        std::env::var_os("APPIMAGE").is_none() && std::path::Path::new(PACKAGED).exists()
    }

    pub fn is_installed() -> bool {
        if packaged() {
            return true;
        }
        let (Some(app), Some(path)) = (app(), script_path()) else {
            return false;
        };
        std::fs::read_to_string(path).is_ok_and(|c| c == super::linux_script(&app))
    }

    pub fn try_silent_install() {
        if !is_installed() {
            let _ = install();
        }
    }

    pub fn install() -> Result<(), String> {
        use std::os::unix::fs::PermissionsExt;
        if packaged() {
            return Ok(());
        }
        let app = app().ok_or("No app path.")?;
        let path = script_path().ok_or("No home folder.")?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, super::linux_script(&app)).map_err(|e| e.to_string())?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())
    }
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
mod imp {
    pub fn is_installed() -> bool {
        false
    }

    pub fn try_silent_install() {}

    pub fn install() -> Result<(), String> {
        Err("The 'textus' command isn't available here.".into())
    }
}

pub use imp::try_silent_install;

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn cli_command_status() -> bool {
    imp::is_installed()
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn install_cli_command() -> Result<(), String> {
    imp::install()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_path_is_added_once() {
        let dir = r"C:\Users\a\AppData\Local\Textus\bin";
        assert!(path_has(r"C:\x;c:\users\a\appdata\local\textus\BIN\;", dir));
        assert!(!path_has(r"C:\x;C:\Users\a\AppData\Local\Textus", dir));
        assert_eq!(path_with("", dir), dir);
        assert_eq!(path_with(r"C:\x;", dir), format!(r"C:\x;{dir}"));
    }

    #[test]
    fn scripts_pass_their_arguments_on() {
        assert_eq!(
            windows_script("Textus.exe"),
            "@echo off\r\nstart \"\" \"%~dp0..\\Textus.exe\" %*\r\n"
        );
        assert_eq!(
            linux_script("/home/a/it's/Textus.AppImage"),
            "#!/bin/sh\nexec setsid -f '/home/a/it'\\''s/Textus.AppImage' \"$@\" >/dev/null 2>&1\n"
        );
    }
}
