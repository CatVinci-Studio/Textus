//! Open at login: an entry the OS starts `textus --background` from at
//! login. Written by hand rather than through tauri-plugin-autostart, which
//! leaves the program's path unquoted (a Windows user folder with a space
//! in it breaks the Run entry) and would add a plugin to every launch:
//!
//! - Windows: the `Textus` value of HKCU\…\CurrentVersion\Run. The
//!   installer removes that same value on uninstall (installer.nsi).
//! - macOS: a launch agent, ~/Library/LaunchAgents/<identifier>.plist.
//! - Linux: an XDG autostart entry, ~/.config/autostart/textus.desktop.
//!
//! The entry names this launch's executable - an AppImage's own file, not
//! the mount it runs from - and is written again at each startup while it
//! is on, so an AppImage that moved keeps starting.

#[cfg(not(windows))]
use std::path::PathBuf;
use tauri::AppHandle;
#[cfg(not(windows))]
use tauri::Manager;

use super::CLI_FLAG;

/// The program the entry starts.
fn executable() -> Result<String, String> {
    if let Some(appimage) = std::env::var_os("APPIMAGE").filter(|p| !p.is_empty()) {
        return Ok(appimage.to_string_lossy().into_owned());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe
        .canonicalize()
        .unwrap_or(exe)
        .to_string_lossy()
        .into_owned())
}

/// Writes the entry (`on`) or removes it (if it is there).
pub fn set(app: &AppHandle, on: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = app;
        windows_set(on)
    }
    #[cfg(not(windows))]
    {
        let path = entry_path(app)?;
        if !on {
            return match std::fs::remove_file(&path) {
                Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err.to_string()),
                _ => Ok(()),
            };
        }
        let exe = executable()?;
        #[cfg(target_os = "macos")]
        let text = launch_agent(&app.config().identifier, &exe);
        #[cfg(not(target_os = "macos"))]
        let text = desktop_entry(&exe);
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        crate::atomic::write_sync(&path, text).map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "macos")]
fn entry_path(app: &AppHandle) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(home
        .join("Library/LaunchAgents")
        .join(format!("{}.plist", app.config().identifier)))
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn entry_path(app: &AppHandle) -> Result<PathBuf, String> {
    // $XDG_CONFIG_HOME, or ~/.config.
    let config = app.path().config_dir().map_err(|e| e.to_string())?;
    Ok(config.join("autostart").join("textus.desktop"))
}

#[cfg(windows)]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
/// Where Task Manager's Startup tab records an entry the user turned off.
#[cfg(windows)]
const STARTUP_APPROVED_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

#[cfg(windows)]
fn windows_set(on: bool) -> Result<(), String> {
    use windows_registry::CURRENT_USER;
    let name = crate::app_identity::APP_NAME;
    let run = CURRENT_USER.create(RUN_KEY).map_err(|e| e.to_string())?;
    if on {
        run.set_string(name, run_command(&executable()?))
            .map_err(|e| e.to_string())?;
        // Turned on here after Task Manager turned it off: on again.
        if let Ok(approved) = CURRENT_USER.options().write().open(STARTUP_APPROVED_KEY) {
            let _ = approved.remove_value(name);
        }
    } else {
        // Not there is fine.
        let _ = run.remove_value(name);
    }
    Ok(())
}

/// The Run value: the program quoted, as a path with spaces needs.
#[cfg_attr(not(windows), allow(dead_code))]
fn run_command(exe: &str) -> String {
    format!("\"{exe}\" {CLI_FLAG}")
}

/// The XDG autostart entry. Exec's quoting is the Desktop Entry spec's:
/// an argument with a space or a reserved character goes in double quotes,
/// with `"`, `` ` ``, `$` and `\` escaped, and `%` doubled anywhere.
#[cfg_attr(any(windows, target_os = "macos"), allow(dead_code))]
fn desktop_entry(exe: &str) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name={name}\n\
         Exec={exec} {CLI_FLAG}\n\
         Icon=textus\n\
         Terminal=false\n\
         NoDisplay=true\n\
         X-GNOME-Autostart-enabled=true\n",
        name = crate::app_identity::APP_NAME,
        exec = desktop_exec_arg(exe),
    )
}

#[cfg_attr(any(windows, target_os = "macos"), allow(dead_code))]
fn desktop_exec_arg(arg: &str) -> String {
    let arg = arg.replace('%', "%%");
    let plain = arg
        .chars()
        .all(|c| !c.is_whitespace() && !"\"'\\><~|&;$*?#()`".contains(c));
    if plain {
        return arg;
    }
    let mut quoted = String::from("\"");
    for c in arg.chars() {
        if matches!(c, '"' | '`' | '$' | '\\') {
            quoted.push('\\');
        }
        quoted.push(c);
    }
    quoted.push('"');
    quoted
}

/// The launch agent: run once at login, never kept alive - quitting
/// Textus ends it until the next login. AssociatedBundleIdentifiers makes
/// System Settings › Login Items show it as Textus, not as a bare program.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn launch_agent(identifier: &str, exe: &str) -> String {
    let escape = |s: &str| {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{id}</string>
  <key>AssociatedBundleIdentifiers</key>
  <array><string>{id}</string></array>
  <key>ProgramArguments</key>
  <array><string>{exe}</string><string>{CLI_FLAG}</string></array>
  <key>RunAtLoad</key>
  <true/>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
</dict>
</plist>
"#,
        id = escape(identifier),
        exe = escape(exe),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_windows_entry_quotes_the_program() {
        assert_eq!(
            run_command(r"C:\Users\Jane Doe\AppData\Local\Textus\textus.exe"),
            r#""C:\Users\Jane Doe\AppData\Local\Textus\textus.exe" --background"#
        );
    }

    #[test]
    fn the_autostart_entry_starts_in_the_background() {
        let entry = desktop_entry("/usr/bin/textus");
        assert!(entry.starts_with("[Desktop Entry]\n"));
        assert!(entry.contains("\nExec=/usr/bin/textus --background\n"));
        assert!(entry.contains("\nType=Application\n"));
    }

    #[test]
    fn the_autostart_entry_quotes_a_path_as_the_desktop_entry_spec_says() {
        assert_eq!(
            desktop_exec_arg("/home/jane/My Apps/Textus.AppImage"),
            "\"/home/jane/My Apps/Textus.AppImage\""
        );
        assert_eq!(desktop_exec_arg("/opt/a$b"), "\"/opt/a\\$b\"");
        assert_eq!(desktop_exec_arg("/opt/100%"), "/opt/100%%");
        assert_eq!(desktop_exec_arg("/usr/bin/textus"), "/usr/bin/textus");
    }

    #[test]
    fn the_launch_agent_runs_the_program_once_at_login() {
        let plist = launch_agent(
            "com.catvinci.textus",
            "/Applications/Textus & Co.app/Contents/MacOS/textus",
        );
        assert!(plist.contains("<string>com.catvinci.textus</string>"));
        assert!(plist.contains(
            "<array><string>/Applications/Textus &amp; Co.app/Contents/MacOS/textus</string><string>--background</string></array>"
        ));
        assert!(plist.contains("<key>RunAtLoad</key>\n  <true/>"));
        assert!(!plist.contains("KeepAlive"));
    }
}
