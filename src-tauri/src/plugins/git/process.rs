//! The user's own git, run for a plugin's call: found on the login PATH,
//! told to ask for nothing, its risky settings off (safety.rs), and stopped
//! when it takes too long.

use super::safety;
use std::path::{Path, PathBuf};

/// The git to run: on the login PATH; on macOS /usr/bin/git only with the
/// developer tools there, as it otherwise asks to install them.
fn git_program() -> Option<PathBuf> {
    #[cfg(desktop)]
    {
        // Found once; looked for again while there is none (installed since).
        static GIT: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);
        let mut known = GIT.lock().unwrap_or_else(|e| e.into_inner());
        if known.is_none() {
            *known = find_git();
        }
        known.clone()
    }
    #[cfg(not(desktop))]
    None
}

#[cfg(desktop)]
fn find_git() -> Option<PathBuf> {
    let found = crate::mcp::path::find_program("git", &crate::mcp::path::login_path())?;
    #[cfg(target_os = "macos")]
    if found == Path::new("/usr/bin/git") {
        let tools = std::process::Command::new("/usr/bin/xcode-select")
            .arg("-p")
            .output()
            .is_ok_and(|o| o.status.success());
        if !tools {
            return None;
        }
    }
    Some(found)
}

/// How long a call may take: reading is quick; a commit runs the writer's
/// hooks and signing.
const READ_TIME: std::time::Duration = std::time::Duration::from_secs(30);
pub(super) const COMMIT_TIME: std::time::Duration = std::time::Duration::from_secs(180);

/// git in `dir`, never asking for anything; its output, or what it said
/// went wrong.
pub(super) fn run(dir: &Path, args: &[&str], input: Option<&str>) -> Result<Vec<u8>, String> {
    run_within(dir, args, input, READ_TIME)
}

/// The same, stopped after `time`: a hook waiting for an answer, a prompt
/// that never shows.
pub(super) fn run_within(
    dir: &Path,
    args: &[&str],
    input: Option<&str>,
    time: std::time::Duration,
) -> Result<Vec<u8>, String> {
    use std::io::{Read, Write};
    use std::process::Stdio;
    let program = git_program().ok_or("Git isn't installed on this computer.")?;
    let mut command = crate::spawn::quiet_command(program);
    command
        .current_dir(dir)
        .args(["-c", "core.quotepath=off", "-c", "color.ui=false"])
        .args(safety::QUIET)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    if let (Some(text), Some(mut stdin)) = (input, child.stdin.take()) {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    // Read as it runs: a full pipe would hold it up.
    let read = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut all = Vec::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_end(&mut all);
            }
            all
        })
    };
    let stdout = read(child.stdout.take().map(|p| Box::new(p) as _));
    let stderr = read(child.stderr.take().map(|p| Box::new(p) as _));
    let started = std::time::Instant::now();
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break status,
            None if started.elapsed() > time => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Git took too long and was stopped.".to_string());
            }
            None => std::thread::sleep(std::time::Duration::from_millis(15)),
        }
    };
    let out = stdout.join().unwrap_or_default();
    if status.success() {
        Ok(out)
    } else {
        let said = String::from_utf8_lossy(&stderr.join().unwrap_or_default())
            .trim()
            .to_string();
        Err(if said.is_empty() {
            "git failed.".to_string()
        } else {
            said
        })
    }
}
