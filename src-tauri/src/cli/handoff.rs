//! Handing the terminal's paths to the app window, the way the old scripts
//! did: `open -a` on macOS, a detached process elsewhere, so the terminal
//! gets its prompt back at once.

use std::path::Path;
use std::process::{Command, Stdio};

/// Set by the installed `textus` script, so the binary knows a terminal
/// started it rather than the system.
pub const SCRIPT_ENV: &str = "TEXTUS_CLI";

/// The .app holding this binary (…/Textus.app/Contents/MacOS/textus).
#[cfg(target_os = "macos")]
fn bundle() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let app = exe.parent()?.parent()?.parent()?;
    (app.extension()? == "app").then(|| app.to_path_buf())
}

/// Starts the app (or wakes the running one) with `args`, without waiting.
pub fn launch(args: &[String]) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = Command::new("open");
        match bundle() {
            Some(app) => c.arg("-a").arg(app),
            None => c.arg("-a").arg(crate::app_identity::APP_NAME),
        };
        c
    };
    #[cfg(not(target_os = "macos"))]
    let mut command = detached(&self_path()?);
    command
        .args(args)
        .env_remove(SCRIPT_ENV)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(target_os = "macos")]
    let started = command.status().map(|s| s.success());
    #[cfg(not(target_os = "macos"))]
    let started = command.spawn().map(|_| true);
    match started {
        Ok(true) => Ok(()),
        Ok(false) => Err("Textus couldn't open that.".into()),
        Err(e) => Err(format!("Textus couldn't be started: {e}")),
    }
}

/// The program to start again: the AppImage (this binary lives in its mount,
/// which goes away when this process ends), else this binary.
#[cfg(not(target_os = "macos"))]
fn self_path() -> Result<std::path::PathBuf, String> {
    std::env::var_os("APPIMAGE")
        .map(Into::into)
        .map_or_else(std::env::current_exe, Ok)
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn detached(program: &Path) -> Command {
    let mut c = Command::new("setsid");
    c.arg("-f").arg(program);
    c
}

#[cfg(windows)]
fn detached(program: &Path) -> Command {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    let mut c = Command::new(program);
    c.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    c
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn detached(program: &Path) -> Command {
    Command::new(program)
}

/// Each argument that names a file made absolute against `cwd`; flags and
/// textus:// links stay as they are.
pub fn absolute(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .map(|a| {
            if a.starts_with('-') || crate::plugins::uri::is_textus_uri(a) {
                a.clone()
            } else {
                super::resolve(cwd, a).to_string_lossy().into_owned()
            }
        })
        .collect()
}

/// Windows: a release build has no console of its own, so its output goes
/// to the terminal that started it, unless that output is redirected.
#[cfg(windows)]
pub fn attach_console() {
    use windows::Win32::System::Console::{
        AttachConsole, GetStdHandle, ATTACH_PARENT_PROCESS, STD_OUTPUT_HANDLE,
    };
    unsafe {
        let redirected =
            GetStdHandle(STD_OUTPUT_HANDLE).is_ok_and(|h| !h.is_invalid() && !h.0.is_null());
        if !redirected {
            let _ = AttachConsole(ATTACH_PARENT_PROCESS);
        }
    }
}

#[cfg(not(windows))]
pub fn attach_console() {}

/// Connects to the app, starting it and waiting for its listener when it
/// isn't running.
pub fn connect_or_launch() -> Result<impl std::io::Read + std::io::Write, String> {
    if let Some(stream) = super::ipc::connect() {
        return Ok(stream);
    }
    launch(&[])?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(100));
        if let Some(stream) = super::ipc::connect() {
            return Ok(stream);
        }
    }
    Err("Textus was started but didn't answer within 30 seconds.".into())
}
