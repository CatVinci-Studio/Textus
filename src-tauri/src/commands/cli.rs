//! Installs the `textus` terminal command: a script that runs the app's own
//! binary marked as started from a terminal (`crate::cli::SCRIPT_ENV`), which
//! answers commands itself and hands paths to the app window at once.
//! - macOS: `/usr/local/bin/textus` runs the binary inside the .app, or
//!   `open -a Textus` once that is gone.
//! - Windows: `bin\textus.cmd` beside the app, that folder on the user's PATH.
//! - Linux: the .deb/.rpm ship the binary itself as `/usr/bin/textus`;
//!   otherwise (the AppImage) `~/.local/bin/textus`.
//!
//! Startup installs it quietly where no password is needed; Settings ›
//! General retries. On Windows startup only writes the script: the user's
//! PATH is changed only from Settings, and never unless it was read whole.

use serde::Serialize;

#[cfg(target_os = "macos")]
mod imp {
    use super::CliStatus;
    use crate::app_identity::APP_NAME;

    const CLI_BIN_PATH: &str = "/usr/local/bin/textus";

    /// This binary when it runs from an .app; a dev build has none.
    fn bundled_exe() -> Option<String> {
        let exe = std::env::current_exe().ok()?;
        let in_app = exe.parent()?.parent()?.parent()?.extension()? == "app";
        in_app.then(|| exe.to_string_lossy().into_owned())
    }

    fn script_content() -> String {
        super::mac_script(bundled_exe().as_deref(), APP_NAME)
    }

    fn write_direct() -> std::io::Result<()> {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;
        fs::write(CLI_BIN_PATH, script_content())?;
        fs::set_permissions(CLI_BIN_PATH, fs::Permissions::from_mode(0o755))?;
        Ok(())
    }

    /// A dev build takes any script as current, so it never swaps an
    /// installed app's script for its own.
    pub fn status() -> CliStatus {
        CliStatus::of(std::fs::read_to_string(CLI_BIN_PATH).ok(), |s| {
            bundled_exe().is_none() || s == script_content()
        })
    }

    /// Installs only when `/usr/local/bin` is user-writable, rather than
    /// prompt for a password at startup.
    pub fn try_silent_install() {
        if status() != CliStatus::Installed {
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

/// `/usr/local/bin/textus`: the binary at `exe`, falling back to
/// `open -a` (the whole script before commands, and still a dev build's).
#[cfg(any(target_os = "macos", test))]
fn mac_script(exe: Option<&str>, app_name: &str) -> String {
    let open = format!("exec open -a \"{app_name}\" \"$@\"\n");
    let Some(exe) = exe else {
        return format!("#!/bin/bash\n{open}");
    };
    let quoted = exe.replace('\'', "'\\''");
    let env = crate::cli::SCRIPT_ENV;
    format!("#!/bin/sh\nif [ -x '{quoted}' ]; then\n  {env}=1 exec '{quoted}' \"$@\"\nfi\n{open}")
}

/// `textus.cmd`: waits for the binary, which prints and returns its exit
/// code, or hands paths to the window and returns at once. `%~dp0..` keeps
/// it working when the install folder moves.
#[cfg(any(windows, test))]
fn windows_script(exe_name: &str) -> String {
    let env = crate::cli::SCRIPT_ENV;
    format!("@echo off\r\nsetlocal\r\nset \"{env}=1\"\r\n\"%~dp0..\\{exe_name}\" %*\r\n")
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

/// The PATH to write: `old` (None when the user has none) with `dir` added
/// at its end, or None when it can't be shown to keep every entry of `old`
/// - the one check between a read and a write that could lose the user's
/// PATH.
#[cfg(any(windows, test))]
fn next_path(old: Option<&str>, dir: &str) -> Option<String> {
    let old = old.unwrap_or("");
    if dir.trim().is_empty() || dir.contains(';') {
        return None;
    }
    let next = path_with(old, dir);
    let kept = old.trim_end_matches(';');
    (next.starts_with(kept) && next.len() > kept.len()).then_some(next)
}

#[cfg(windows)]
mod imp {
    use super::CliStatus;
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

    /// The user's PATH as it is stored: None when there is none; an error
    /// when it can't be read whole, and then nothing writes it.
    fn user_path() -> Result<Option<(String, Type)>, String> {
        // HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND): no key, or no value.
        const NOT_FOUND: u32 = 0x8007_0002;
        let key = match CURRENT_USER.open(ENV_KEY) {
            Ok(key) => key,
            Err(e) if e.code().0 as u32 == NOT_FOUND => return Ok(None),
            Err(e) => return Err(e.to_string()),
        };
        let value = match key.get_value("Path") {
            Ok(value) => value,
            Err(e) if e.code().0 as u32 == NOT_FOUND => return Ok(None),
            Err(e) => return Err(e.to_string()),
        };
        let ty = value.ty();
        if !matches!(ty, Type::String | Type::ExpandString) {
            return Err("PATH is not text.".into());
        }
        let text = String::try_from(value).map_err(|e| e.to_string())?;
        Ok(Some((text, ty)))
    }

    pub fn status() -> CliStatus {
        let Ok((name, bin)) = paths() else {
            return CliStatus::Missing;
        };
        let on_path = |p: &str| match user_path() {
            Ok(Some((path, _))) => super::path_has(&path, p),
            _ => false,
        };
        CliStatus::of(std::fs::read_to_string(bin.join("textus.cmd")).ok(), |s| {
            s == super::windows_script(&name) && on_path(&bin.to_string_lossy())
        })
    }

    /// At startup: the script only, kept current. The PATH is the user's
    /// own; it is changed only when they ask (Settings › General).
    pub fn try_silent_install() {
        if let Ok((name, bin)) = paths() {
            if bin.join("textus.cmd").exists() {
                let _ = std::fs::write(bin.join("textus.cmd"), super::windows_script(&name));
            }
        }
    }

    pub fn install() -> Result<(), String> {
        let (name, bin) = paths()?;
        std::fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
        std::fs::write(bin.join("textus.cmd"), super::windows_script(&name))
            .map_err(|e| e.to_string())?;
        let dir = bin.to_string_lossy().into_owned();
        // Not read whole: left as it is.
        let old = user_path()?;
        if let Some((path, _)) = &old {
            if super::path_has(path, &dir) {
                return Ok(());
            }
        }
        let next = super::next_path(old.as_ref().map(|(p, _)| p.as_str()), &dir)
            .ok_or("PATH left unchanged.")?;
        // What it was, beside the script, before anything is written.
        if let Some((path, _)) = &old {
            std::fs::write(bin.join("PATH-before-textus.txt"), path).map_err(|e| e.to_string())?;
        }
        let key = CURRENT_USER.create(ENV_KEY).map_err(|e| e.to_string())?;
        let ty = old
            .as_ref()
            .map(|(_, ty)| ty.clone())
            .unwrap_or(Type::ExpandString);
        let write = |text: &str| match ty {
            Type::String => key.set_string("Path", text),
            _ => key.set_expand_string("Path", text),
        };
        write(&next).map_err(|e| e.to_string())?;
        // Read back: anything but what was meant, and the old one goes back.
        if !matches!(user_path(), Ok(Some((ref now, _))) if *now == next) {
            if let Some((path, _)) = &old {
                let _ = write(path);
            }
            return Err("PATH could not be checked; put back as it was.".into());
        }
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

/// `sh` script for `~/.local/bin/textus`: the AppImage, which detaches the
/// window from the terminal itself.
#[cfg(any(target_os = "linux", test))]
fn linux_script(app: &str) -> String {
    let quoted = app.replace('\'', "'\\''");
    let env = crate::cli::SCRIPT_ENV;
    format!("#!/bin/sh\n{env}=1 exec '{quoted}' \"$@\"\n")
}

#[cfg(target_os = "linux")]
mod imp {
    use super::CliStatus;
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

    pub fn status() -> CliStatus {
        if packaged() {
            return CliStatus::Installed;
        }
        let (Some(app), Some(path)) = (app(), script_path()) else {
            return CliStatus::Missing;
        };
        CliStatus::of(std::fs::read_to_string(path).ok(), |s| {
            s == super::linux_script(&app)
        })
    }

    pub fn try_silent_install() {
        if status() != CliStatus::Installed {
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
    use super::CliStatus;

    pub fn status() -> CliStatus {
        CliStatus::Missing
    }

    pub fn try_silent_install() {}

    pub fn install() -> Result<(), String> {
        Err("The 'textus' command isn't available here.".into())
    }
}

pub use imp::try_silent_install;

/// What Settings shows: `Outdated` is a script an older Textus wrote,
/// which only opens the app.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum CliStatus {
    Installed,
    Outdated,
    Missing,
}

impl CliStatus {
    /// From the script found, if any, and whether it is this app's.
    #[cfg_attr(
        not(any(target_os = "macos", windows, target_os = "linux", test)),
        allow(dead_code)
    )]
    fn of(script: Option<String>, current: impl FnOnce(&str) -> bool) -> Self {
        match script {
            None => Self::Missing,
            Some(s) if current(&s) => Self::Installed,
            Some(_) => Self::Outdated,
        }
    }
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn cli_command_status() -> CliStatus {
    imp::status()
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
    fn windows_path_keeps_every_entry_or_is_not_written() {
        let dir = r"C:\Users\a\AppData\Local\Textus\bin";
        let old = r"C:\Python;%USERPROFILE%\go\bin;";
        let next = next_path(Some(old), dir).unwrap();
        assert!(next.starts_with(r"C:\Python;%USERPROFILE%\go\bin"));
        assert!(next.ends_with(dir));
        // No PATH yet: only ours.
        assert_eq!(next_path(None, dir).as_deref(), Some(dir));
        // Nothing that could cut the user's PATH.
        assert_eq!(next_path(Some(old), ""), None);
        assert_eq!(next_path(Some(old), "a;b"), None);
    }

    #[test]
    fn scripts_run_the_binary_marked_as_from_a_terminal() {
        assert_eq!(
            windows_script("Textus.exe"),
            "@echo off\r\nsetlocal\r\nset \"TEXTUS_CLI=1\"\r\n\"%~dp0..\\Textus.exe\" %*\r\n"
        );
        assert_eq!(
            linux_script("/home/a/it's/Textus.AppImage"),
            "#!/bin/sh\nTEXTUS_CLI=1 exec '/home/a/it'\\''s/Textus.AppImage' \"$@\"\n"
        );
        assert_eq!(
            mac_script(
                Some("/Applications/Textus.app/Contents/MacOS/textus"),
                "Textus"
            ),
            "#!/bin/sh\nif [ -x '/Applications/Textus.app/Contents/MacOS/textus' ]; then\n  \
             TEXTUS_CLI=1 exec '/Applications/Textus.app/Contents/MacOS/textus' \"$@\"\nfi\n\
             exec open -a \"Textus\" \"$@\"\n"
        );
    }

    #[test]
    fn a_script_an_older_textus_wrote_needs_updating() {
        let exe = "/Applications/Textus.app/Contents/MacOS/textus";
        let current = |s: &str| s == mac_script(Some(exe), "Textus");
        let older = "#!/bin/bash\nexec open -a \"Textus\" \"$@\"\n".to_string();
        assert_eq!(CliStatus::of(Some(older), current), CliStatus::Outdated);
        let now = mac_script(Some(exe), "Textus");
        assert_eq!(CliStatus::of(Some(now), current), CliStatus::Installed);
        assert_eq!(CliStatus::of(None, current), CliStatus::Missing);
    }

    #[test]
    fn a_dev_build_keeps_the_script_that_opens_the_installed_app() {
        assert_eq!(
            mac_script(None, "Textus"),
            "#!/bin/bash\nexec open -a \"Textus\" \"$@\"\n"
        );
    }
}
