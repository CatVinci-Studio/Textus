//! One SFTP link to a host, through the user's own `ssh` (its config with
//! Include, Match and ProxyJump, its agent, keys and known_hosts) asked for
//! the sftp subsystem only: no shell, no command, no forwarding. Nothing is
//! answered for the user: an unknown host key or a password ssh would ask
//! for ends the link with words saying what to do.

use russh_sftp::client::SftpSession;
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};

/// How long ssh may take to reach the host and start sftp.
const CONNECT_WAIT: Duration = Duration::from_secs(30);

/// Why a link failed, as the frontend tells the user.
pub(crate) const UNKNOWN_HOST: &str = "ssh-unknown-host";
pub(crate) const NEEDS_LOGIN: &str = "ssh-needs-login";

pub(crate) struct Link {
    pub(crate) plugin: String,
    pub(crate) sftp: SftpSession,
    child: tokio::sync::Mutex<Child>,
}

impl Link {
    pub(crate) async fn close(&self) {
        let _ = self.sftp.close().await;
        let _ = self.child.lock().await.kill().await;
    }
}

/// A host as ssh's config or the user names it: never an option.
pub(crate) fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 255
        && !host.starts_with('-')
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-@:[]%".contains(c))
}

/// The ssh that is run: the system's, on every desktop.
fn ssh_program() -> &'static str {
    if cfg!(windows) {
        "ssh.exe"
    } else {
        "ssh"
    }
}

/// What ssh said on its way out, as one of the codes above or its words.
fn reason(stderr: &str) -> String {
    let said = stderr.to_lowercase();
    if said.contains("host key verification failed")
        || said.contains("no matching host key")
        || said.contains("remote host identification has changed")
    {
        return format!("{UNKNOWN_HOST}: {}", last_line(stderr));
    }
    if said.contains("permission denied") || said.contains("too many authentication failures") {
        return format!("{NEEDS_LOGIN}: {}", last_line(stderr));
    }
    let line = last_line(stderr);
    if line.is_empty() {
        "The connection closed.".to_string()
    } else {
        line
    }
}

fn last_line(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .rfind(|l| !l.is_empty())
        .unwrap_or_default()
        .to_string()
}

/// A new link to `host` for `plugin`. `config` replaces `~/.ssh/config`
/// (tests only).
pub(crate) async fn open(plugin: &str, host: &str, config: Option<&Path>) -> Result<Link, String> {
    if !valid_host(host) {
        return Err(format!("{host} isn't a host name."));
    }
    let mut command = Command::new(ssh_program());
    if let Some(config) = config {
        command.arg("-F").arg(config);
    }
    command
        .args([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=15",
            "-o",
            "ServerAliveInterval=15",
            "-o",
            "ClearAllForwardings=yes",
            "-T",
            "-s",
            "--",
            host,
            "sftp",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("ssh couldn't be started: {e}"))?;
    let (Some(stdin), Some(stdout), Some(mut stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        return Err("ssh couldn't be started.".into());
    };
    // What ssh says, kept for when the link fails.
    let said = Arc::new(Mutex::new(String::new()));
    let keep = said.clone();
    tokio::spawn(async move {
        let mut buf = [0u8; 1024];
        while let Ok(n) = stderr.read(&mut buf).await {
            if n == 0 {
                break;
            }
            if let Ok(mut text) = keep.lock() {
                if text.len() < 16 * 1024 {
                    text.push_str(&String::from_utf8_lossy(&buf[..n]));
                }
            }
        }
    });
    let stream = tokio::io::join(stdout, stdin);
    let started = tokio::time::timeout(CONNECT_WAIT, SftpSession::new(stream)).await;
    match started {
        Ok(Ok(sftp)) => Ok(Link {
            plugin: plugin.to_string(),
            sftp,
            child: tokio::sync::Mutex::new(child),
        }),
        Ok(Err(_)) | Err(_) => {
            let _ = child.kill().await;
            // Its last words arrive as it exits.
            tokio::time::sleep(Duration::from_millis(100)).await;
            let text = said.lock().map(|t| t.clone()).unwrap_or_default();
            Err(if started.is_err() && text.is_empty() {
                format!("{host} didn't answer.")
            } else {
                reason(&text)
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_host_names_never_options() {
        assert!(valid_host("box-1.lan"));
        assert!(valid_host("me@[::1]"));
        assert!(!valid_host("-oProxyCommand=x"));
        assert!(!valid_host("a b"));
        assert!(!valid_host(""));
    }

    #[test]
    fn names_why_a_link_failed() {
        assert!(reason("Host key verification failed.\r\n").starts_with(UNKNOWN_HOST));
        assert!(reason("me@box: Permission denied (publickey).\n").starts_with(NEEDS_LOGIN));
        assert_eq!(reason(""), "The connection closed.");
    }
}
