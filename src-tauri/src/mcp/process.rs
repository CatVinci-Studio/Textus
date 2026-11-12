//! A program started from the user's login PATH with its three pipes, as
//! MCP servers and external agents both run: its standard error kept, the
//! last few thousand characters, to explain a failure.

use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};

const STDERR_KEEP: usize = 4_000;

pub(crate) struct Piped {
    pub child: Child,
    pub stdin: ChildStdin,
    pub stdout: ChildStdout,
    /// The tail of what it wrote to standard error, filled as it runs.
    pub stderr: Arc<Mutex<String>>,
}

/// Starts `program` in `cwd` (when that is a folder), killed when dropped.
pub(crate) fn start(
    program: &str,
    args: &[String],
    env: &[(String, String)],
    cwd: Option<&str>,
) -> Result<Piped, String> {
    let path = super::path::login_path();
    let resolved = super::path::find_program(program, &path).ok_or_else(|| {
        format!("`{program}` isn't installed, or isn't on the PATH Textus sees ({path})")
    })?;
    let mut command = tokio::process::Command::new(resolved);
    command
        .args(args)
        .env("PATH", &path)
        .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = cwd.filter(|c| std::path::Path::new(c).is_dir()) {
        command.current_dir(cwd);
    }
    // No console window flashing up for it.
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command
        .spawn()
        .map_err(|e| format!("couldn't start `{program}`: {e}"))?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    let kept: Arc<Mutex<String>> = Arc::default();
    let filling = kept.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let mut kept = filling.lock().unwrap_or_else(|e| e.into_inner());
            kept.push_str(&line);
            kept.push('\n');
            if kept.len() > STDERR_KEEP {
                let cut = (kept.len() - STDERR_KEEP..kept.len())
                    .find(|i| kept.is_char_boundary(*i))
                    .unwrap_or(0);
                kept.replace_range(..cut, "");
            }
        }
    });
    Ok(Piped {
        child,
        stdin,
        stdout,
        stderr: kept,
    })
}
