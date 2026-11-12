//! Where an MCP server's command is found. An app opened from the Dock lacks a
//! terminal's PATH, so the login shell is asked once and the usual places added.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// `login_path` asked off the async runtime: the first ask runs the login
/// shell, which can take seconds.
pub async fn ready_login_path() {
    let _ = tokio::task::spawn_blocking(login_path).await;
}

/// The PATH a terminal would have, with the usual tool folders after it.
pub fn login_path() -> String {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let mut dirs: Vec<String> = Vec::new();
        let mut add = |list: &str| {
            for dir in std::env::split_paths(list) {
                let dir = dir.to_string_lossy().to_string();
                if !dir.is_empty() && !dirs.contains(&dir) {
                    dirs.push(dir);
                }
            }
        };
        if let Some(shell) = shell_path() {
            add(&shell);
        }
        add(&std::env::var("PATH").unwrap_or_default());
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            let home = PathBuf::from(home);
            for sub in [
                ".local/bin",
                ".cargo/bin",
                ".bun/bin",
                ".deno/bin",
                ".volta/bin",
            ] {
                add(&home.join(sub).to_string_lossy());
            }
        }
        #[cfg(unix)]
        add("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
        std::env::join_paths(&dirs)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default()
    })
    .clone()
}

/// What the login shell says PATH is, within a few seconds.
#[cfg(unix)]
fn shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut child = std::process::Command::new(shell)
        .args(["-ilc", "printf '\\n%s\\n' \"$PATH\""])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    // Read while it runs: a chatty profile would otherwise fill the pipe and
    // never exit.
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut out = String::new();
        let _ = std::io::Read::read_to_string(&mut stdout, &mut out);
        let _ = tx.send(out);
    });
    let Ok(out) = rx.recv_timeout(std::time::Duration::from_secs(5)) else {
        let _ = child.kill();
        let _ = child.wait();
        return None;
    };
    let _ = child.wait();
    // The last line: a profile may print greetings before it.
    out.lines()
        .rev()
        .find(|l| l.contains('/'))
        .map(str::to_string)
}

#[cfg(not(unix))]
fn shell_path() -> Option<String> {
    None
}

/// `program` as a file to run: a path as given, or the first match on
/// `path` (with Windows's extensions).
pub fn find_program(program: &str, path: &str) -> Option<PathBuf> {
    let given = Path::new(program);
    if given.components().count() > 1 {
        return given.is_file().then(|| given.to_path_buf());
    }
    let extensions: &[&str] = if cfg!(windows) {
        &["", ".exe", ".cmd", ".bat"]
    } else {
        &[""]
    };
    std::env::split_paths(path).find_map(|dir| {
        extensions
            .iter()
            .map(|ext| dir.join(format!("{program}{ext}")))
            .find(|candidate| candidate.is_file())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_program_is_found_on_the_path_and_a_path_is_taken_as_given() {
        let dir = std::env::temp_dir().join(format!("textus-mcp-path-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let tool = dir.join(if cfg!(windows) { "tool.exe" } else { "tool" });
        std::fs::write(&tool, "").unwrap();
        let path = std::env::join_paths([dir.clone()]).unwrap();
        let path = path.to_string_lossy();
        assert_eq!(find_program("tool", &path), Some(tool.clone()));
        assert_eq!(find_program("missing", &path), None);
        assert_eq!(find_program(&tool.to_string_lossy(), ""), Some(tool));
    }
}
